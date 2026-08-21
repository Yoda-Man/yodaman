/**
 * How much prompt to spend, given the context window Ollama is actually serving.
 *
 * 9B is meant to be the FLOOR of what YodaMan supports, not the ceiling. It had
 * become the ceiling by accident: the agent compacted hard for small windows,
 * and every other case fell through to a flat 9,000-character budget. A 32B
 * model served at 131,072 tokens got the same 9,000 characters as a 9B model
 * served at 8,192 — roughly 2% of the window, with the rest simply unused.
 *
 * The budget now scales with the window, so a larger model is actually worth
 * running.
 *
 * Two deliberate conservatisms, both load-bearing:
 *
 * 1. Only the CONFIGURED window is trusted, never the model's declared maximum.
 *    Ollama serves what OLLAMA_CONTEXT_LENGTH says, or picks by VRAM when it is
 *    unset — often 4096, whatever the model declares it could do. Sizing a
 *    prompt against the declared maximum is how prompts overflowed in 0.4.6:
 *    llama-server runs with --context-shift, which drops from the FRONT, so the
 *    system prompt carrying the tool instructions is what gets silently cut. The
 *    model then answers with citations and no tool call.
 *
 * 2. The floors are the values used before this existed, so no configuration
 *    gets a smaller budget than it had. This can only spend more where more is
 *    known to be available.
 */

/**
 * Average characters per token for source code and English prose. Deliberately
 * low: underestimating tokens-per-char means over-estimating how many tokens a
 * prompt costs, which errs toward a smaller prompt.
 */
const CHARS_PER_TOKEN = 3.5;

/**
 * The share of the window YodaMan's own prompt may occupy. ctx prepends its
 * retrieved chunks on top of whatever we send, and the model still needs room
 * to answer, so the majority of the window is deliberately left alone.
 */
const PROMPT_SHARE = 0.35;

/** Today's flat budget, kept as the floor so nothing regresses. */
const MIN_PROMPT_CHARS = 9000;

/**
 * ContextEngine rejects a single invocation above this, so a budget beyond it
 * would only produce a thrown request.
 */
const MAX_PROMPT_CHARS = 120000;

/** Per-tool-result clip. The floor is the value used before this existed. */
const MIN_ENTRY_CHARS = 6000;
const MAX_ENTRY_CHARS = 48000;
const ENTRY_SHARE = 0.4;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Prompt budget for a serving context window.
 *
 * @param {number|null|undefined} effectiveContextTokens - The window Ollama is
 *   actually serving, or null when it is unknown. Unknown yields the floors,
 *   which is the behaviour that existed before this function.
 * @returns {{maxPromptChars: number, maxEntryChars: number}}
 */
function promptBudgetFor(effectiveContextTokens) {
    const tokens = Number(effectiveContextTokens);
    if (!Number.isFinite(tokens) || tokens <= 0) {
        return { maxPromptChars: MIN_PROMPT_CHARS, maxEntryChars: MIN_ENTRY_CHARS };
    }

    const windowChars = tokens * CHARS_PER_TOKEN;
    const maxPromptChars = clamp(Math.floor(windowChars * PROMPT_SHARE), MIN_PROMPT_CHARS, MAX_PROMPT_CHARS);
    const maxEntryChars = clamp(Math.floor(maxPromptChars * ENTRY_SHARE), MIN_ENTRY_CHARS, MAX_ENTRY_CHARS);

    return { maxPromptChars, maxEntryChars };
}

module.exports = {
    promptBudgetFor,
    CHARS_PER_TOKEN,
    PROMPT_SHARE,
    MIN_PROMPT_CHARS,
    MAX_PROMPT_CHARS,
    MIN_ENTRY_CHARS,
    MAX_ENTRY_CHARS
};
