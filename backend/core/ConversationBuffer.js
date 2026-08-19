/**
 * ConversationBuffer — the agent's transcript, bounded.
 *
 * `ctx ask` is stateless: it takes one question per invocation and keeps nothing
 * between calls, so the whole conversation has to be re-sent every iteration.
 * The loop used to do that by appending to a plain string, which had three
 * compounding costs:
 *
 *   1. Quadratic tokens. Iteration N re-sends everything from iterations 1..N-1.
 *      A 10-step task pays for the first step's context ten times.
 *   2. Poisoned retrieval. `ctx ask` runs RAG over the question text, so the
 *      question *is* the retrieval query. Handing it a 40KB transcript makes the
 *      query embedding meaningless and the retrieved chunks close to random.
 *   3. A hard ceiling. The prompt travels as a single argv entry, and argv plus
 *      environment share ARG_MAX (1MB on macOS, often 128KB per entry on Linux).
 *      One `readFile` on a large file could push a task past it and turn the
 *      next spawn into E2BIG — a crash, not a degradation.
 *
 * So the transcript is bounded here instead. Three mechanisms, in order of how
 * much they save:
 *
 *   Per-entry truncation — a tool result is clipped as it arrives. Reading a
 *   5,000-line file should cost the transcript a readable head and a note, not
 *   5,000 lines that will be re-sent on every remaining iteration.
 *
 *   Windowing — the newest turns survive verbatim, because that is what the next
 *   decision depends on. The original task always survives too; it is the one
 *   line that must never be elided.
 *
 *   Digesting — older turns collapse to one line each recording which tool ran
 *   and how it ended. This keeps the fact that work happened (so the model does
 *   not repeat it) without keeping its bulk. Deliberately mechanical: an LLM
 *   summary would cost a round trip per iteration and could invent history.
 */

/**
 * Total prompt budget, measured rather than guessed.
 *
 * Answer length against prompt size for the configured local model
 * (qwen3.5:9b via `ctx ask`, same workspace and question each time):
 *
 *     1,051 chars in → 649 out      7,051 → 609
 *     3,051         → 227           9,051 → 267
 *     5,051         → 293          12,051 →  41   ← collapse
 *
 * Answers hold up to roughly 9k and then fall apart: at 12k the model returns a
 * citation list and essentially no prose. So the ceiling that matters is the
 * model's, not ARG_MAX — a prompt can be perfectly deliverable and still be too
 * long to be answered. Raise this for a larger-context model via
 * YODAMAN_AGENT_PROMPT_CHARS.
 */
const DEFAULT_MAX_PROMPT_CHARS = Number(process.env.YODAMAN_AGENT_PROMPT_CHARS) || 9000;

// A tool result larger than this is clipped on arrival, whatever the budget.
const MAX_ENTRY_CHARS = 6000;

// However tight things get, the newest turns survive: below this the model loses
// the tool result it just asked for and starts repeating the call.
const MIN_VERBATIM_TURNS = 2;

// Floor for the history window. The system prompt and brief can be large enough
// to leave nothing over; when that happens the transcript still gets this much,
// and the oversized-prompt path is reported by stats() rather than hidden.
const MIN_HISTORY_CHARS = 1500;

/** Clip text to a character budget, saying how much was removed. */
function clip(text, maxChars = MAX_ENTRY_CHARS) {
    const value = typeof text === 'string' ? text : JSON.stringify(text, null, 2) ?? String(text);
    if (value.length <= maxChars) return value;
    const removed = value.length - maxChars;
    return `${value.slice(0, maxChars)}\n… [${removed} more characters omitted from the transcript]`;
}

/** One line describing a tool result without carrying its payload. */
function digestToolResult(tool, result) {
    if (result && typeof result === 'object' && result.error) {
        return `${tool} → error: ${String(result.error).slice(0, 120)}`;
    }
    if (result && typeof result === 'object') {
        const keys = Object.keys(result).slice(0, 6).join(', ');
        return `${tool} → ok {${keys}}`;
    }
    return `${tool} → ${String(result).slice(0, 80)}`;
}

class ConversationBuffer {
    /**
     * @param {object} options
     * @param {string} options.system      System prompt. Sent on every call — ctx has no session to hold it.
     * @param {string} [options.brief]     Stardust brief: the workspace's own state, built once per task.
     * @param {string} options.task        The user's task. Never elided.
     * @param {number} [options.maxPromptChars] Whole-prompt budget, not just the history.
     */
    constructor({ system, brief = '', task, maxPromptChars = DEFAULT_MAX_PROMPT_CHARS, maxEntryChars = MAX_ENTRY_CHARS }) {
        this.system = system || '';
        this.brief = brief || '';
        this.task = task || '';
        this.maxPromptChars = maxPromptChars;
        // Scales with the serving window: on a large context a whole file is worth
        // keeping verbatim, where 6,000 characters would cut it mid-function.
        this.maxEntryChars = maxEntryChars;
        /** @type {Array<{role: string, text: string, digest: string}>} */
        this.turns = [];
        /** Turns dropped from the window, kept as one-line digests. */
        this.digests = [];
    }

    /** Everything that is not turn history: system prompt, brief, task, digests. */
    fixedChars() {
        return this.system.length + this.brief.length + this.task.length + this.renderDigests().length + 16;
    }

    /**
     * What the history is allowed to occupy.
     *
     * Derived rather than fixed: a big system prompt or brief has to come out of
     * the same budget, since the model sees one prompt and does not care which
     * part of it was cheap to produce.
     */
    historyBudget() {
        return Math.max(MIN_HISTORY_CHARS, this.maxPromptChars - this.fixedChars());
    }

    /** Per-entry cap, scaled so a single result cannot fill the whole window. */
    entryCap() {
        return Math.max(600, Math.min(this.maxEntryChars, Math.floor(this.historyBudget() / 2)));
    }

    addAssistant(text) {
        const value = clip(String(text || '').trim(), this.entryCap());
        if (!value) return;
        this.turns.push({ role: 'Assistant', text: value, digest: 'assistant reasoning' });
    }

    addToolResult(tool, result) {
        this.turns.push({
            role: 'System (Tool Result)',
            text: clip(result, this.entryCap()),
            digest: digestToolResult(tool, result),
        });
    }

    addNote(text) {
        const value = String(text || '').trim();
        if (!value) return;
        this.turns.push({ role: 'System', text: clip(value, 1200), digest: value.slice(0, 100) });
    }

    /**
     * Move the oldest turns into digests until the window fits the budget.
     * Returns the number of turns collapsed on this pass.
     */
    compact() {
        let collapsed = 0;
        // Recomputed each round: every collapsed turn adds a digest line, which
        // grows the fixed part and shrinks what is left for history.
        while (this.turns.length > MIN_VERBATIM_TURNS && this.historyChars() > this.historyBudget()) {
            const oldest = this.turns.shift();
            this.digests.push(oldest.digest);
            collapsed += 1;
        }

        // The newest turns are kept even when they overflow, so a single huge
        // result cannot silently erase the step the model is reasoning about. Clip
        // it instead, and let stats() report the prompt is over budget.
        const cap = this.entryCap();
        for (const turn of this.turns) {
            if (turn.text.length > cap) turn.text = clip(turn.text, cap);
        }

        return collapsed;
    }

    historyChars() {
        return this.turns.reduce((total, turn) => total + turn.role.length + turn.text.length + 4, 0);
    }

    renderDigests() {
        if (this.digests.length === 0) return '';
        return [
            '',
            '',
            `--- Earlier steps in this task (${this.digests.length}, summarized to stay within context) ---`,
            ...this.digests.map((digest, i) => `${i + 1}. ${digest}`),
            '--- End of earlier steps ---',
        ].join('\n');
    }

    /** The prompt to hand to `ctx ask`. Compacts first, so it always fits. */
    render() {
        this.compact();

        const parts = [this.system];
        if (this.brief) parts.push(this.brief);
        // The task goes last of the fixed parts: on a long prompt the model
        // attends to the end most reliably, and the task is what it must answer.
        parts.push(`\n\nUser Task: ${this.task}`);
        parts.push(this.renderDigests());

        for (const turn of this.turns) {
            parts.push(`\n\n${turn.role}: ${turn.text}`);
        }

        return parts.join('');
    }

    stats() {
        const promptChars = this.render().length;
        return {
            turns: this.turns.length,
            digested: this.digests.length,
            historyChars: this.historyChars(),
            promptChars,
            budget: this.maxPromptChars,
            // True when the fixed parts alone exceed the budget — the transcript
            // cannot be squeezed any further, so this is worth seeing in the logs
            // rather than being quietly tolerated.
            overBudget: promptChars > this.maxPromptChars,
        };
    }
}

module.exports = ConversationBuffer;
module.exports.MAX_ENTRY_CHARS = MAX_ENTRY_CHARS;
module.exports.DEFAULT_MAX_PROMPT_CHARS = DEFAULT_MAX_PROMPT_CHARS;
module.exports.clip = clip;
