const contextEngine = require('../infrastructure/ContextEngine');
const { stripCliNoise, hasSubstantiveAnswer } = require('../infrastructure/CliOutput');
const impactAnalyzer = require('../infrastructure/ImpactAnalyzer');
const specDrift = require('../stardust/SpecDrift');
const toolBox = require('../infrastructure/ToolBox');
const { pluginCapability } = require('../../shared/pluginInvocation');
const taskStore = require('../infrastructure/TaskStore');
const graphifyService = require('../infrastructure/GraphifyService');
const logger = require('../infrastructure/Logger');
const defaultCodingSkill = require('./DefaultCodingSkill');
const queueService = require('./QueueService');
const ConversationBuffer = require('./ConversationBuffer');
const { promptBudgetFor } = require('./promptBudget');
const { requiresApproval } = require('../../shared/toolCapabilities');
const stardustBrief = require('./StardustBrief');
const dependencyChecker = require('../infrastructure/DependencyChecker');

// Tools whose success invalidates the retrieval index and the knowledge graph.
const MUTATING_TOOLS = new Set(['writeFile']);

/**
 * Most tool calls a model may act on in a single turn.
 *
 * A bound, not a target. A model that has lost the thread can emit dozens of
 * calls, and fanning all of them out at once turns one confused turn into a
 * burst of filesystem work. Five covers every legitimate "read these files
 * together" case seen in practice.
 */
const MAX_PARALLEL_TOOL_CALLS = 5;

/**
 * Every tool call in a model response, in the order it wrote them.
 *
 * THE BUG THIS REPLACES:
 *
 *     const toolCallMatch = response.match(/<tool_call>([\s\S]*?)<\/tool_call>/)
 *
 * `String.match` without the `g` flag returns the FIRST match only. Everything
 * after it was discarded with no error and no log line. A model emitting three
 * reads had two thrown away silently.
 *
 * The cost was mostly not lost work — it was wasted iterations. The model saw
 * one result, re-emitted the rest, and three calls consumed three turns instead
 * of one. Against `maxIterations = 10` that burns the budget roughly three
 * times faster than the work requires, and the user sees "I reached the maximum
 * number of steps without finishing" on a task that needed a dozen file reads.
 * The logs showed nothing but ordinary `agent_iteration` events.
 *
 * Returns `{ calls, malformed }`. Malformed blocks are RETURNED, never dropped:
 * silence is the defect being fixed here, and a bad block the model is told
 * about is something it can correct on the next turn.
 *
 * @param {string} response
 * @param {number} limit
 * @returns {{calls: object[], malformed: string[], total: number}}
 */
function extractToolCalls(response, limit = MAX_PARALLEL_TOOL_CALLS) {
    if (typeof response !== 'string' || !response) {
        return { calls: [], malformed: [], total: 0 };
    }

    // Both delimiters, global this time. TOOL_CALL is the wire format; the
    // angle-bracket form is still parsed because a model may emit it from
    // habit. See the note at the call site for why the plain-text delimiter
    // matters to ctx 1.4.0.
    const raw = [
        ...response.matchAll(/TOOL_CALL\s*(\{[\s\S]*?\})\s*(?:\n|$)/g),
        ...response.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)
    ];

    // A model that emits both forms in one response would otherwise have its
    // calls ordered by delimiter rather than by what it actually wrote.
    raw.sort((a, b) => a.index - b.index);

    const calls = [];
    const malformed = [];

    for (const match of raw) {
        const text = String(match[1]).trim();
        if (!text) continue;

        let parsed = null;
        let reason = null;

        try {
            parsed = JSON.parse(text);
        } catch (err) {
            // Keep the message: the caller reports it to the model and to the
            // task record, and "Unexpected end of JSON input" is far more
            // actionable than "a call failed". Small models truncate mid-object
            // often enough that this is the common path, not the rare one.
            reason = err.message;
            const repaired = repairJSON(text);
            if (repaired) {
                try {
                    parsed = JSON.parse(repaired);
                    reason = null;
                } catch (repairErr) {
                    // Repair produced something still unparseable. The ORIGINAL
                    // error is the useful one — it describes what the model
                    // actually wrote — so keep it and discard this second one.
                    reason = err.message;
                }
            }
        }

        if (parsed && typeof parsed.name === 'string') {
            calls.push({ call: parsed, raw: text });
        } else {
            malformed.push({
                raw: text.slice(0, 200),
                reason: reason || 'tool call had no "name"'
            });
        }
    }

    return { calls: calls.slice(0, limit), malformed, total: calls.length };
}

function safeToolName(rawToolCall) {
    try {
        return JSON.parse(rawToolCall).name;
    } catch {
        // Used only to label a malformed tool call in an error message. If the
        // JSON will not parse there is no name to report, and the caller is
        // already handling the parse failure that brought us here.
        return undefined;
    }
}

/**
 * AgentReasoningEngine (Core Layer)
 * 
 * Orchestrates the autonomous "thought" loop of the AI.
 * It manages context, parses tool calls, and interacts with the infrastructure layer
 * to execute actions and gather information.
 */
// Budgets for a small model, whose context the full prompt plus ctx's retrieved
// chunks will not fit. Both are deliberately conservative: an answer that fits
// beats a richer prompt that gets truncated from the front.
const COMPACT_PROMPT_CHARS = 5000;
const COMPACT_TOP_K = 3;

/**
 * What the file will contain if this edit is approved.
 *
 * The reviewer is asked to consent to a result, not to a parameter list.
 * applyPatch supplies oldText/newText rather than whole content, so without
 * this the diff panel had nothing to show for the tool that does most editing.
 * Mirrors ToolBox.applyPatch exactly — single unique occurrence, replaced once —
 * so the preview is what will actually be written, not an approximation.
 *
 * Returns null when the result cannot be predicted; the caller then falls back
 * to showing the raw arguments rather than inventing a diff.
 */
function proposedContent(toolCall, oldContent) {
    const params = toolCall.parameters || {};

    switch (toolCall.name) {
    case 'writeFile':
        return params.content;

    case 'applyPatch': {
        const { oldText, newText } = params;
        if (typeof oldContent !== 'string' || typeof oldText !== 'string' || typeof newText !== 'string') {
            return null;
        }
        // A patch that does not match uniquely fails in ToolBox anyway, so
        // showing a speculative diff for it would be a lie.
        if (oldContent.split(oldText).length - 1 !== 1) return null;
        return oldContent.replace(oldText, newText);
    }

    default:
        // Not a file edit, so there is no "after" to show. The caller falls
        // back to displaying the arguments.
        return null;
    }
}

class AgentReasoningEngine {
    constructor() {
        /** @type {Map<string, Function>} Pending approval resolvers. */
        this.pendingApprovals = new Map();
        /** @type {Map<string, object>} Recent task state for external clients. */
        this.tasks = new Map(taskStore.list().map((task) => [task.taskId, task]));
        /** @type {Set<string>} Task IDs that should stop at the next safe point. */
        this.cancelledTasks = new Set();
        /** @type {number} Maximum number of tool iterations to prevent infinite loops. */
        this.maxIterations = 10;
    }

    /**
     * Dynamically builds the system prompt with current tools and plugins.
     */
    getSystemPrompt() {
        return `
You are Yoda-Agent, a powerful coding assistant integrated into the YodaMan platform.
You have access to the following tools to help the user with their coding tasks:

${toolBox.getToolDefinitions()}

${defaultCodingSkill}

### Process:
- Read the Stardust Brief below the system prompt first — it contains the workspace's structural state,
  OpenSpec intent, and per-file risk analysis. Do not re-derive what it already tells you.
- Use tools to gather information or make changes. To call one, write a line of
  literal text in exactly this form — do not use native function calling:
TOOL_CALL {"name": "readFile", "parameters": { "filePath": "path/to/file.js" }}

  Use a real tool name from the list above. The line here is a worked example,
  not a template to copy the words out of.
- If the user names a tool to run ("Run CodeTrooper"), call it immediately as
  your entire reply, using the active workspace path given below.
- After a tool call the system provides the result. Continue until the task is done, then give a final summary.
- Be concise and precise.

### The three tools that power every answer:
- Context Expert (semantic search + LLM reasoning): use searchCode(query, project) to find files by meaning.
- Graphify (knowledge graph): use impactOf(file, project) before editing to see blast radius and tests.
  The brief already covers focus files — call impactOf only for files it does not name.
- OpenSpec (architecture intent): use specDrift before building to avoid re-implementing documented work.
  Use specPropose → specValidate → specArchive for multi-file features.

### Before you edit:
- Call impactOf(file, project) on any file you intend to change that the brief does not already cover.
  It returns dependents, covering tests and the specs describing that file from an in-process graph read.
- If impactOf reports dependents and no covering tests, say so and add or extend a test before changing behaviour.
- Prefer applyPatch over writeFile for edits to existing files: a targeted replacement, not a whole-file rewrite.
- When you cite structure from the graph or the brief, append a '[view graph](http://localhost:5190)' link,
  and say how many files a proposed change would reach.

### Context discipline:
Earlier steps of a long task may appear collapsed under "Earlier steps in this task".
That is a real record of work already done — do not repeat those tool calls. If you need a
detail that was collapsed, call the tool again for that detail rather than re-running the
whole sequence.
`;
    }

    /**
     * Shorter prompt for models below 14B params.
     * Drops verbose sections, uses terse one-line-per-tool summary.
     */
    getCompactSystemPrompt() {
        return `
You are Yoda-Agent. Tools:

${toolBox.getBriefToolDefinitions()}

Rules:
- Read the Stardust Brief first — it has graph structure, specs, and per-file risks.
- Call (literal text, never native function calling), using a real tool name:
  TOOL_CALL {"name":"readFile","parameters":{"filePath":"path/to/file.js"}}
- If the user names a tool to run ("Run CodeTrooper"), call it immediately as
  your entire reply, using the active workspace path given below.
- Before editing: impactOf(file). No tests covering → say so.
- Multi-file features: specPropose → specValidate → specArchive.
- Check specDrift first to avoid re-implementing documented work.
- Be concise.
- You may emit SEVERAL read-only calls in one turn (readFile, listFiles, searchCode, graphify*, specDrift, specValidate) and they run together. Prefer this to asking for files one at a time.
- Emit only ONE call per turn when it changes anything (writeFile, applyPatch, specPropose, specArchive, executeCommand): each needs separate approval.
`;
    }

    /**
     * Signals that an action has been approved or rejected.
     */
    signalApproval(taskId, approved) {
        const resolver = this.pendingApprovals.get(taskId);
        if (resolver) {
            const task = this.tasks.get(taskId);
            if (task) {
                task.status = approved ? 'running' : 'rejected';
                task.pendingApproval = null;
                task.updatedAt = new Date().toISOString();
            }
            resolver(approved);
            this.pendingApprovals.delete(taskId);
        }
    }

    /**
     * Requests cancellation for an active task.
     */
    cancelTask(taskId) {
        this.cancelledTasks.add(taskId);
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'cancelling';
            task.updatedAt = new Date().toISOString();
        }
        const resolver = this.pendingApprovals.get(taskId);
        if (resolver) {
            resolver(false);
            this.pendingApprovals.delete(taskId);
        }
    }

    isCancelled(taskId) {
        return this.cancelledTasks.has(taskId);
    }

    getTasks() {
        return Array.from(this.tasks.values()).sort((a, b) => {
            const left = a.updatedAt || a.createdAt || '';
            const right = b.updatedAt || b.createdAt || '';
            return right.localeCompare(left);
        });
    }

    getPendingApprovals() {
        return this.getTasks()
            .filter((task) => task.pendingApproval)
            .map((task) => ({
                taskId: task.taskId,
                task: task.task,
                projectId: task.projectId,
                createdAt: task.createdAt,
                updatedAt: task.updatedAt,
                approval: task.pendingApproval
            }));
    }

    getTaskEvents(taskId) {
        return (this.tasks.get(taskId) || {}).events || [];
    }

    recordTask(taskId, patch) {
        const current = this.tasks.get(taskId) || {};
        const nextTask = {
            ...current,
            ...patch,
            taskId,
            updatedAt: new Date().toISOString()
        };
        this.tasks.set(taskId, nextTask);

        if (this.tasks.size > 50) {
            const oldest = this.getTasks().at(-1);
            if (oldest) this.tasks.delete(oldest.taskId);
        }

        taskStore.upsert(taskId, nextTask);
    }

    recordTaskEvent(taskId, event) {
        const current = this.tasks.get(taskId) || { taskId, events: [] };
        const events = [...(current.events || []), {
            timestamp: new Date().toISOString(),
            ...event
        }].slice(-200);
        this.recordTask(taskId, { events });
    }

    /**
     * The plugin a task names outright, or null when there is any doubt.
     *
     * Matches "run <name>", tolerating the separator drift between a plugin's
     * registered name and how a person writes it (Droid-Sweep vs "Droid Sweep"),
     * and a trailing qualifier such as "on this workspace". Everything else —
     * two candidates, a plugin that can modify anything, an unloaded name —
     * returns null and takes the normal reasoning path.
     */
    resolveDirectPluginCall(task) {
        const text = String(task || '').trim();
        const match = /^run\s+(.+?)(?:\s+(?:on|for|against|in)\s+.*)?$/i.exec(text);
        if (!match) return null;

        const wanted = match[1].trim().toLowerCase().replace(/[\s_-]+/g, '');
        if (!wanted) return null;

        // toolBox.plugins is absent in test doubles and before plugins load.
        if (!toolBox.plugins || typeof toolBox.plugins.entries !== 'function') return null;

        const candidates = [...toolBox.plugins.entries()].filter(([name]) =>
            name.toLowerCase().replace(/[\s_-]+/g, '') === wanted);
        if (candidates.length !== 1) return null;

        // Reuse the capability map the chat dropdown labels plugins with, rather
        // than keeping a second list here. A hand-written check for 'write' and
        // 'command' let holocron-vr through: it declares agent:invoke,
        // task:create and audit:write, none of which match those bare strings,
        // and a plugin that can start agent tasks is exactly what should take
        // the path with the approval gate on it.
        const [name, plugin] = candidates[0];
        if (pluginCapability(plugin)) return null;

        return { name, plugin };
    }

    /** Invoke a named plugin without a model round-trip, emitting the usual events. */
    async runPluginDirectly({ name, plugin }, { taskId, task, onStep, metadata }) {
        const parameters = {};
        for (const key of ['workspacePath', 'projectPath', 'projectRoot']) {
            if (plugin.parameters && plugin.parameters[key]) parameters[key] = metadata.projectId;
        }

        logger.info('agent_plugin_routed_directly', { taskId, plugin: name, task });

        const emit = (event) => {
            this.recordTaskEvent(taskId, event);
            if (onStep) onStep(event);
        };

        emit({ type: 'tool_start', taskId, tool: name, params: parameters, routed: 'direct' });

        try {
            const result = await toolBox.callTool(name, parameters);
            const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            emit({ type: 'tool_end', taskId, tool: name, result: output });

            // Say so in the transcript. A turn that behaves differently from a
            // normal one should not look identical to it.
            const answer = `Ran **${name}** directly (no model call — you named the tool).\n\n${output}`;
            this.recordTask(taskId, { status: 'completed', finalAnswer: answer });
            // Recorded for task history but NOT emitted: RestController sends
            // final_answer from the returned value, and emitting here too put
            // two of them on the stream.
            this.recordTaskEvent(taskId, { type: 'final_answer', taskId, answer });
            return answer;
        } catch (err) {
            logger.error('agent_plugin_direct_failed', err, { taskId, plugin: name });
            this.recordTask(taskId, { status: 'error', error: err.message });
            emit({ type: 'error', taskId, message: err.message });
            return null;
        }
    }

    async executeTask(task, taskId, onStep, metadata = {}) {
        const now = new Date().toISOString();
        this.recordTask(taskId, {
            task,
            projectId: metadata.projectId,
            status: 'running',
            createdAt: now,
            events: [],
            pendingApproval: null,
            finalAnswer: null,
            error: null
        });

        // ── Direct plugin routing ────────────────────────────────────────
        // "Run CodeTrooper" names the tool outright. Asking a 9B model to infer
        // which tool that means costs a retrieval, a model round-trip and about
        // 50 seconds — and it gets it wrong often enough to fail a release gate:
        // Grand-Inquisitor passed twice and then answered in prose instead of
        // calling anything. There is nothing to infer here, so we do not infer.
        //
        // Deliberately narrow. Only an exact name match on a loaded, read-only
        // plugin routes directly. Anything that can write, run commands or holds
        // unrestricted permission goes the long way round, because that path
        // carries the approval gate and speed is never worth skipping consent.
        // Anything ambiguous also goes the long way: this replaces guessing with
        // certainty, and a fuzzy match would just be guessing again.
        const routed = this.resolveDirectPluginCall(task);
        if (routed && metadata.projectId) {
            return this.runPluginDirectly(routed, { taskId, task, onStep, metadata });
        }

        // The workspace's own state, composed from all three tools and scoped to
        // the files this task names. Replaces the blind 4,000-character dump of
        // GRAPH_REPORT.md that used to be prepended to every task regardless of
        // whether the task was structural. Never fatal: a failed brief costs
        // context, not the task.
        let brief = '';
        if (metadata.projectId) {
            try {
                brief = (await stardustBrief.build(metadata.projectId, task)).text;
            } catch (err) {
                logger.warn('stardust_brief_failed', { taskId, path: metadata.projectId, reason: err.message });
            }
        }

        const uploadedFileContext = Array.isArray(metadata.uploadedFiles) && metadata.uploadedFiles.length
            ? [
                '',
                '',
                'Attached local files for this task:',
                ...metadata.uploadedFiles.map(file => `- ${file.filename} (${file.size} bytes): ${file.path}`)
            ].join('\n')
            : '';

        // Bounded transcript. ctx keeps no session, so every iteration re-sends
        // the conversation — which made a plain growing string quadratic in
        // tokens and eventually large enough to exceed ARG_MAX.
        // Models <14B get a shorter prompt + tighter budget automatically.
        let compact = false;
        try {
            compact = dependencyChecker.isWeakModel(await dependencyChecker.detectCtxModel());
        } catch (err) {
            // Never block a task on model detection — but say so, because a
            // silent failure here downgrades every prompt without explanation.
            logger.warn('agent_model_detect_failed', { taskId, reason: err?.message });
        }
        // Several plugins declare workspacePath as a required ABSOLUTE path, and
        // neither the system prompt nor the Stardust Brief ever stated it — the
        // brief describes files workspace-relative. Asked to "Run CodeTrooper"
        // the agent correctly replied that it needed an absolute path nobody had
        // given it, and never called the tool. Say it plainly.
        const workspaceContext = metadata.projectId
            ? `\n\nActive workspace (absolute path — use this for any tool needing workspacePath, projectPath or a project root): ${metadata.projectId}`
            : '';

        // The prompt budget governs what WE send. ctx then prepends its retrieved
        // chunks on top, and the two together have to fit the model's context —
        // 4096 tokens for qwen3.5:9b. At the default budget plus five chunks the
        // total overflowed, and llama-server runs with --context-shift, which
        // drops from the FRONT: the system prompt carrying the tool instructions.
        // The model then answered with citations and no tool call, which is the
        // agent_empty_answer path. It accounted for 9 of 22 iterations measured.
        // Small models therefore get both a tighter budget and fewer chunks.
        // Compaction is a response to a small serving window, not to a small
        // model. Where the window is genuinely large, trimming the prompt just
        // throws away context the model could have used — so ask, and only
        // compact when it is warranted.
        let smallContext = true;
        let effectiveContext = null;
        try {
            const ctxWindow = await dependencyChecker.detectOllamaContext();
            smallContext = ctxWindow.small;
            effectiveContext = ctxWindow.effective;
            if (!smallContext && compact) {
                logger.info('agent_compact_relaxed', {
                    taskId,
                    configured: ctxWindow.configured,
                    reason: 'serving context is large enough for the full prompt'
                });
            }
        } catch (err) {
            logger.warn('agent_context_probe_failed', { taskId, reason: err?.message });
        }

        const trim = compact && smallContext;

        // 9B is the floor YodaMan supports, not the ceiling. Where the window is
        // genuinely larger, the budget grows with it instead of falling through
        // to the flat figure that fitted a small model — otherwise a 32B model
        // served at 131,072 tokens gets the same prompt as a 9B served at 8,192.
        // Trimming still wins when it applies: a small window is a hard limit,
        // not a preference.
        const budget = promptBudgetFor(effectiveContext);
        const promptChars = trim ? COMPACT_PROMPT_CHARS : budget.maxPromptChars;
        const entryChars = trim ? undefined : budget.maxEntryChars;
        const topK = trim ? COMPACT_TOP_K : undefined;

        const conversation = new ConversationBuffer({
            ...(promptChars ? { maxPromptChars: promptChars } : {}),
            ...(entryChars ? { maxEntryChars: entryChars } : {}),
            system: (trim ? this.getCompactSystemPrompt() : this.getSystemPrompt()) + workspaceContext + uploadedFileContext,
            brief,
            task,
        });

        let iteration = 0;
        // Workspaces this task wrote to, refreshed once when the task ends.
        const touchedWorkspaces = new Set();
        let finalAnswer = '';

        logger.info('agent_loop_started', { taskPreview: task.substring(0, 50) });

        while (iteration < this.maxIterations) {
            if (this.isCancelled(taskId)) {
                const event = { type: 'task_cancelled', taskId, message: 'Task cancelled.' };
                this.recordTaskEvent(taskId, event);
                if (onStep) onStep(event);
                this.recordTask(taskId, { status: 'cancelled' });
                this.cancelledTasks.delete(taskId);
                return null;
            }

            iteration++;
            logger.info('agent_iteration', { iteration, maxIterations: this.maxIterations });

            // Scoping to the workspace is what makes retrieval mean anything —
            // unscoped, ctx answers against every indexed project at once.
            const prompt = conversation.render();
            const stats = conversation.stats();
            logger.info('agent_prompt_built', {
                taskId,
                iteration,
                promptChars: stats.promptChars,
                budget: stats.budget,
                turns: stats.turns,
                digested: stats.digested,
            });

            // The fixed parts alone are over budget, so compaction cannot help.
            // Answer quality falls off measurably past the budget, so this is the
            // one prompt condition worth surfacing rather than absorbing.
            if (stats.overBudget) {
                logger.warn('agent_prompt_over_budget', {
                    taskId,
                    iteration,
                    promptChars: stats.promptChars,
                    budget: stats.budget,
                    hint: 'The system prompt and Stardust brief exceed the budget on their own. Reduce the number of loaded plugins, or raise YODAMAN_AGENT_PROMPT_CHARS if the model has a larger context window.',
                });
            }

            const raw = await contextEngine.ask(prompt, { project: metadata.projectId, topK });
            const output = stripCliNoise(raw.output);

            if (this.isCancelled(taskId)) {
                const event = { type: 'task_cancelled', taskId, message: 'Task cancelled.' };
                this.recordTaskEvent(taskId, event);
                if (onStep) onStep(event);
                this.recordTask(taskId, { status: 'cancelled' });
                this.cancelledTasks.delete(taskId);
                return null;
            }
            
            const response = output.trim();
            conversation.addAssistant(response);

            // ctx can exit mid-generation and still have written part of an answer;
            // ContextEngine.ask salvages it rather than losing it. But a truncated
            // response must not be presented as a finished one — with ctx 1.4.0 this
            // happens precisely when the model starts emitting a tool call, so the
            // step that got cut off is usually the one that mattered.
            if (raw.partial) {
                logger.warn('agent_response_truncated', {
                    taskId,
                    iteration,
                    chars: response.length,
                    reason: raw.error,
                    hint: 'ctx exited non-zero while streaming the answer. Answer salvaged but incomplete.',
                });
                const event = { type: 'response_truncated', taskId, iteration, message: raw.error };
                this.recordTaskEvent(taskId, event);
                if (onStep) onStep(event);
            }

            // Generation produced nothing but the RAG citation block. Retrying is
            // worth a step: this is intermittent, and accepting it means the user's
            // answer is a list of filenames.
            if (!hasSubstantiveAnswer(response)) {
                logger.warn('agent_empty_answer', {
                    taskId,
                    iteration,
                    chars: response.length,
                    hint: 'ctx returned citations with no generated text. Retrying with an explicit instruction.',
                });
                conversation.addNote('Your previous response contained only citations and no answer. Reply with exactly ONE of: a direct answer in prose, or a single TOOL_CALL {"name":"readFile","parameters":{"filePath":"path/to/file"}} line.');
                if (iteration < this.maxIterations) continue;

                finalAnswer = 'Context Expert returned source citations but no generated answer, on every attempt. Check that the configured model is reachable (`yodaman doctor`) and that the prompt is within its context window. For reliable tool-calling, use a model with ≥14B parameters (e.g. qwen2.5:14b, codestral:22b, deepseek-coder-v2). Current model: see Health dashboard.';
                break;
            }

            // TOOL_CALL is the wire format; the angle-bracket form is still parsed
            // because a model may emit it from habit.
            //
            // The delimiter is load-bearing, not cosmetic. Prompting qwen3.5:9b
            // with the literal string "<tool_call>" flips it into Ollama's native
            // function-calling mode, and ctx 1.4.0 mishandles the result: it puts
            // an undefined into the follow-up messages array, its Ollama provider
            // dereferences .content on it (message-mapper.ts:46), and the
            // resulting TypeError is reported as "Failed to connect to Ollama
            // server" because errors.ts:118 classifies every TypeError as a
            // connection fault. Every agent task needing a tool died there. The
            // plain-text delimiter never triggers native mode, so the loop works.
            const extracted = extractToolCalls(response);
            const descriptorFor = (name) => (
                toolBox.plugins && typeof toolBox.plugins.get === 'function'
                    ? toolBox.plugins.get(name)
                    : null
            );

            // A block the model wrote and we could not parse is reported, never
            // discarded. Being told about a malformed call is what lets a model
            // correct it; silence is what made the original bug invisible.
            // A malformed call is an ERROR the task must surface, not a note to
            // file away. The first version of this change filtered malformed
            // blocks out silently; with no valid call left, the loop fell
            // through to "no tool call" and returned the raw broken text as the
            // final answer. That is a new silent failure introduced inside the
            // fix for silent failures, and AgentReasoningEngine.test.js caught
            // it. The pre-existing contract is: emit an error, record it, and
            // let the model try again.
            if (extracted.malformed.length) {
                const reason = extracted.malformed[0].reason;
                logger.error('agent_tool_call_malformed', new Error(reason), {
                    taskId, iteration, count: extracted.malformed.length,
                    userAction: 'agent_tool_call', severity: 'high'
                });

                const event = { type: 'error', taskId, message: reason };
                this.recordTaskEvent(taskId, event);
                if (onStep) onStep(event);
                this.recordTask(taskId, { status: 'error', error: reason });
                conversation.addNote(`Error: ${reason}`);

                // Only when nothing else survived. If some calls parsed, run
                // them — one bad block must not discard the good ones.
                if (!extracted.calls.length) {
                    if (iteration < this.maxIterations) continue;
                    finalAnswer = `The model produced an unparseable tool call: ${reason}`;
                    break;
                }
            }

            if (extracted.total > extracted.calls.length) {
                const deferred = extracted.total - extracted.calls.length;
                logger.info('agent_tool_calls_capped', { taskId, iteration, deferred });
                conversation.addNote(
                    `Only the first ${extracted.calls.length} tool calls were run; `
                    + `${deferred} were not. Re-request them if you still need them.`
                );
            }

            // ─── PARALLEL READ-ONLY BATCH ──────────────────────────────────
            //
            // Only when EVERY call in the turn is read-only. Reads cannot
            // conflict with each other, so running them together is safe by
            // construction and the approval gate is not involved at all.
            //
            // Anything requiring consent falls through to the single-call path
            // below, unchanged. Approvals must arrive one at a time and in a
            // predictable order, or a user cannot tell what they are approving
            // — so a batch containing a write is never parallelised.
            const allReadOnly = extracted.calls.length > 1
                && extracted.calls.every(({ call }) => !requiresApproval(call.name, descriptorFor(call.name) || {}));

            if (allReadOnly) {
                logger.info('agent_parallel_tools', {
                    taskId, iteration, count: extracted.calls.length,
                    tools: extracted.calls.map(({ call }) => call.name)
                });

                for (const { call } of extracted.calls) {
                    const startEvent = { type: 'tool_start', taskId, tool: call.name, params: call.parameters };
                    this.recordTaskEvent(taskId, startEvent);
                    if (onStep) onStep(startEvent);
                }

                // allSettled, not all: one failing read must not discard the
                // results of the others — that is the defect being fixed.
                const settled = await Promise.allSettled(
                    extracted.calls.map(({ call }) => toolBox.callTool(call.name, call.parameters))
                );

                // Recorded in CALL order, after every one has settled — never
                // in completion order. ConversationBuffer.addToolResult
                // appends, so completion order would reorder the transcript
                // between runs and show the model a different history for
                // identical work.
                settled.forEach((outcome, i) => {
                    const { call } = extracted.calls[i];
                    const result = outcome.status === 'fulfilled'
                        ? outcome.value
                        : { error: outcome.reason?.message || 'tool failed' };

                    conversation.addToolResult(call.name, result);
                    const endEvent = { type: 'tool_end', taskId, tool: call.name, result };
                    this.recordTaskEvent(taskId, endEvent);
                    if (onStep) onStep(endEvent);
                });

                continue;
            }
            // ───────────────────────────────────────────────────────────────

            // Single-call path, unchanged. `toolCallMatch` keeps its original
            // shape so the error handler below still reports the tool name.
            //
            // Only the first call runs this turn, because the batch contains
            // something needing approval. The REST MUST BE ANNOUNCED: dropping
            // them quietly is the original defect wearing different clothes,
            // and it would be a poor joke to reintroduce it inside its own fix.
            if (extracted.calls.length > 1) {
                const deferred = extracted.calls.slice(1).map(({ call }) => call.name);
                logger.info('agent_tool_calls_deferred', {
                    taskId, iteration, ran: extracted.calls[0].call.name, deferred
                });
                conversation.addNote(
                    `Only ${extracted.calls[0].call.name} ran this turn: a call that changes something `
                    + 'needs its own approval, so calls are not batched with it. '
                    + `Not run: ${deferred.join(', ')}. Re-request them next turn.`
                );
            }

            const first = extracted.calls[0];
            const toolCallMatch = first ? [null, first.raw] : null;

            if (toolCallMatch) {
                try {
                    let rawJson = toolCallMatch[1].trim();
                    // JSON repair for 9B models: fix trailing commas, unquoted keys, missing braces
                    let toolCall;
                    try {
                        toolCall = JSON.parse(rawJson);
                    } catch (parseErr) {
                        const repaired = repairJSON(rawJson);
                        if (repaired) {
                            logger.info('agent_tool_call_repaired', { taskId, iteration, original: rawJson.slice(0, 80), repaired: repaired.slice(0, 80) });
                            toolCall = JSON.parse(repaired);
                        } else {
                            throw parseErr;
                        }
                    }
                    
                    // --- DIFF APPROVAL (The "Trust Gap") ---
                    //
                    // Gated on capability, not on a tool's name. This used to read
                    // `toolCall.name === 'writeFile'`, so applyPatch — which also
                    // writes to disk — ran unchallenged, and writeFile's own
                    // description told the model to prefer it for exactly that
                    // reason. Asking the agent to edit a file without naming a tool
                    // changed the file on disk with no approval event at all.
                    const toolDescriptor = toolBox.plugins && typeof toolBox.plugins.get === 'function'
                        ? toolBox.plugins.get(toolCall.name)
                        : null;

                    if (requiresApproval(toolCall.name, toolDescriptor || {})) {
                        // Both editing tools name a file; anything else may not.
                        const filePath = toolCall.parameters && toolCall.parameters.filePath;
                        const oldContent = filePath ? await toolBox.getFileContent(filePath) : null;
                        const newContent = filePath
                            ? proposedContent(toolCall, oldContent)
                            : null;

                        // A line diff says what changed; it never says what it costs.
                        // Attach the graph-derived blast radius so the reviewer is
                        // making a risk decision, not just reading a diff.
                        const impact = metadata.projectId && filePath
                            ? impactAnalyzer.analyzeFile(metadata.projectId, filePath)
                            : { available: false, reason: filePath ? 'no workspace selected' : 'not a file edit' };

                        // Goldust: add OpenSpec spec awareness to the impact.
                        // Which specs describe this file, and would the change cause drift?
                        let specImpact = { available: false, reason: 'no projectId' };
                        if (metadata.projectId) {
                            try {
                                const specs = specDrift.readSpecs(metadata.projectId);
                                const mentionedIn = [];
                                for (const spec of specs) {
                                    const refs = specDrift.extractReferences(spec.text);
                                    if (filePath && refs.some(r => filePath.includes(r) || r.includes(filePath))) {
                                        mentionedIn.push(spec.id);
                                    }
                                }
                                specImpact = { available: true, specCount: specs.length, mentionedIn };
                            } catch (_) { /* OpenSpec unavailable */ }
                        }

                        logger.info('approval_impact_assessed', {
                            taskId,
                            tool: toolCall.name,
                            filePath: filePath || null,
                            available: impact.available,
                            impactedCount: impact.impactedCount ?? null,
                            testCount: impact.testCount ?? null,
                            risk: impact.risk ?? null,
                            summary: impactAnalyzer.summarize(impact)
                        });

                        const pendingApproval = {
                            tool: toolCall.name,
                            params: {
                                filePath: filePath || null,
                                oldContent,
                                newContent,
                                // Tools that touch no file still have to show what
                                // they intend to do, or consent means nothing.
                                arguments: filePath ? undefined : toolBox.sanitizeParameters
                                    ? toolBox.sanitizeParameters(toolCall.parameters)
                                    : toolCall.parameters
                            },
                            impact,
                            specImpact
                        };

                        this.recordTask(taskId, {
                            status: 'awaiting_approval',
                            pendingApproval
                        });

                        const approvalEvent = {
                            type: 'awaiting_approval',
                            tool: toolCall.name,
                            taskId,
                            params: pendingApproval.params,
                            impact,
                            specImpact
                        };
                        this.recordTaskEvent(taskId, approvalEvent);
                        if (onStep) onStep(approvalEvent);

                        // Wait for approval signal
                        const approved = await new Promise((resolve) => {
                            this.pendingApprovals.set(taskId, resolve);
                        });

                        if (this.isCancelled(taskId)) {
                            const event = { type: 'task_cancelled', taskId, message: 'Task cancelled.' };
                            this.recordTaskEvent(taskId, event);
                            if (onStep) onStep(event);
                            this.recordTask(taskId, { status: 'cancelled', pendingApproval: null });
                            this.cancelledTasks.delete(taskId);
                            return null;
                        }

                        if (!approved) {
                            const result = { error: "User rejected this change." };
                            conversation.addToolResult(toolCall.name, result);
                            const event = { type: 'tool_end', taskId, tool: toolCall.name, result };
                            this.recordTaskEvent(taskId, event);
                            if (onStep) onStep(event);
                            this.recordTask(taskId, { status: 'running', pendingApproval: null });
                            continue; 
                        }

                        this.recordTask(taskId, { status: 'running', pendingApproval: null });
                    }
                    // ---------------------------


                    // A small model that has been told the workspace path still
                    // drops it sometimes. The active project is not ambiguous —
                    // the user selected it — so supply it rather than failing the
                    // call and burning an iteration on a question we can answer.
                    if (metadata.projectId && toolCall.parameters && typeof toolCall.parameters === 'object') {
                        for (const key of ['workspacePath', 'projectPath', 'projectRoot']) {
                            const declared = toolBox.plugins?.get?.(toolCall.name)?.parameters?.[key];
                            const missing = toolCall.parameters[key] === undefined || toolCall.parameters[key] === '';
                            if (declared && missing) {
                                toolCall.parameters[key] = metadata.projectId;
                                logger.info('agent_workspace_param_filled', { taskId, tool: toolCall.name, key });
                            }
                        }
                    }

                    const startEvent = { type: 'tool_start', taskId, tool: toolCall.name, params: toolCall.parameters };
                    this.recordTaskEvent(taskId, startEvent);
                    if (onStep) onStep(startEvent);

                    // Use the unified toolBox.callTool which handles built-ins and plugins
                    const result = await toolBox.callTool(toolCall.name, toolCall.parameters);

                    // Clipped on arrival: a large file read must not be re-sent in
                    // full on every remaining iteration.
                    conversation.addToolResult(toolCall.name, result);


                    // An accepted write makes the ctx index and the graph stale the
                    // moment it lands. Mark the workspace dirty and refresh once
                    // when the task ends, rather than rebuilding per write.
                    if (MUTATING_TOOLS.has(toolCall.name) && !result?.error && metadata.projectId) {
                        touchedWorkspaces.add(metadata.projectId);
                    }

                    const endEvent = { type: 'tool_end', taskId, tool: toolCall.name, result };
                    this.recordTaskEvent(taskId, endEvent);
                    if (onStep) onStep(endEvent);
                } catch (err) {
                    logger.error('agent_tool_failed', err, {
                        taskId,
                        projectId: metadata.projectId,
                        tool: toolCallMatch ? safeToolName(toolCallMatch[1]) : undefined,
                        userAction: 'agent_tool_call',
                        severity: 'high'
                    });
                    conversation.addNote(`Error: ${err.message}`);
                    const event = { type: 'error', taskId, message: err.message };
                    this.recordTaskEvent(taskId, event);
                    if (onStep) onStep(event);
                    this.recordTask(taskId, { status: 'error', error: err.message });
                }
            } else {
                logger.info('agent_task_completed');
                // No tool call to act on. If the response was cut off, say so —
                // otherwise a half-finished thought reads as a considered answer.
                finalAnswer = raw.partial
                    ? `${response}\n\n---\n⚠️ This answer is incomplete: the Context Expert CLI exited while streaming it — ${raw.error || 'unknown reason'}. Ask again, or run the tool the answer was reaching for directly.`
                    : response;
                break;
            }
        }



        // Only when the loop genuinely ran out of steps. A branch that already
        // reached a conclusion — including a specific diagnosis of why it could not
        // answer — has said something more useful than "try smaller parts".
        if (iteration >= this.maxIterations && !finalAnswer) {
            finalAnswer = "I reached the maximum number of steps without finishing. Please try breaking the task into smaller parts.";
            logger.warn('agent_max_iterations_reached', { maxIterations: this.maxIterations });
        }

        this.recordTask(taskId, { status: 'completed', finalAnswer });
        this.recordTaskEvent(taskId, { type: 'final_answer', taskId, answer: finalAnswer });
        this.cancelledTasks.delete(taskId);
        this.refreshTouchedWorkspaces(touchedWorkspaces, taskId);
        return finalAnswer;
    }

    /**
     * Re-sync the retrieval index and knowledge graph for workspaces this task
     * modified. Fire-and-forget: the answer is already on its way to the user,
     * and a failed refresh must never fail the task. Without this, every
     * accepted write silently degrades the next answer.
     */
    refreshTouchedWorkspaces(workspaces, taskId) {
        for (const projectPath of workspaces) {
            logger.info('post_write_refresh_started', { taskId, path: projectPath });

            try {
                queueService.addToQueue(projectPath);
            } catch (err) {
                logger.error('post_write_reindex_failed', err, { taskId, path: projectPath });
            }

            graphifyService.build(projectPath, { update: true })
                .then(() => logger.info('post_write_graph_updated', { taskId, path: projectPath }))
                .catch(err => logger.error('post_write_graph_failed', err, { taskId, path: projectPath }));
        }
    }

    clearTasks() {
        this.tasks.clear();
        this.cancelledTasks.clear();
        this.pendingApprovals.clear();
        taskStore.clear();
    }
}

/**
 * JSON repair for small models. Fixes common mistakes: trailing commas,
 * single quotes used as key/value delimiters, missing closing braces,
 * and unquoted keys. Returns the repaired string or null if unfixable.
 */
function repairJSON(raw) {
    let s = raw.trim();
    // Strip markdown backtick fences some models wrap JSON in
    if (s.startsWith('```') && s.endsWith('```')) {
        s = s.slice(3, -3).trim();
    }
    // Fix trailing comma before }
    s = s.replace(/,\s*}/g, '}');
    // Fix trailing comma before ]
    s = s.replace(/,\s*\]/g, ']');
    // Fix single-quoted keys and values (simple case)
    if (!s.includes('"') && s.includes("'")) {
        try {
            JSON.parse(s.replace(/'/g, '"'));
            s = s.replace(/'/g, '"');
        } catch (_) {
            // The quote swap did not produce valid JSON, so keep the original
            // and let the caller's final parse check reject it.
        }
    }
    // Add missing closing brace
    if (s.startsWith('{') && !s.endsWith('}')) {
        const openBraces = (s.match(/{/g) || []).length;
        const closeBraces = (s.match(/}/g) || []).length;
        s += '}'.repeat(openBraces - closeBraces);
    }
    // Verify the repair actually parses
    try { JSON.parse(s); return s; } catch (_) { return null; }
}

module.exports = new AgentReasoningEngine();

// Test seams. The engine is a singleton, so the pure helpers are attached here
// rather than exported separately — the same pattern as McpClients.reset().
// extractToolCalls is where the dropped-call bug lived, so it is tested
// directly rather than only through a full agent run.
module.exports.extractToolCalls = extractToolCalls;
module.exports.MAX_PARALLEL_TOOL_CALLS = MAX_PARALLEL_TOOL_CALLS;
