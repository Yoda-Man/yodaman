/**
 * Pre-ship gate: drive every installed plugin through the agent exactly as the
 * chat dropdown does, and fail if the tool-call path is broken.
 *
 * Why this exists
 * ---------------
 * 0.4.5 shipped with the agent unable to call a single tool. Lint passed, 492
 * tests passed, release smoke passed, the audit gate passed — because all of
 * them checked code, dependencies and configuration, and none of them ever asked
 * the product to do the thing it exists to do. Prose questions worked, so the
 * runtime looked healthy right up to the moment a user asked for real work.
 *
 * This gate runs the actual user journey: it reads the installed plugins, works
 * out the phrase the dropdown would insert for each (from shared/, so the two
 * cannot drift), posts it as an agent task, and asserts the agent genuinely
 * reached for a tool.
 *
 * What counts as failure
 * ----------------------
 *   response_truncated  the ctx/native-tool-call regression, verbatim
 *   no tool_start       the agent never attempted a tool at all
 *
 * A plugin erroring *after* its tool ran is not a failure here: a plugin can
 * legitimately report "no unused files". This gate proves the path is intact,
 * not that any given plugin likes this workspace.
 *
 * Skipping
 * --------
 * Exits 0 with a clear notice when Ollama or ctx is unavailable, so CI runners
 * without a local model do not fail on an environment they cannot provide. It
 * fails hard whenever those dependencies *are* present — which is the case on
 * the release machine, the only place it matters.
 */
const { spawn } = require('child_process');
const path = require('path');
const { pluginInvocation } = require('../shared/pluginInvocation');

const RUNTIME_URL = process.env.YODAMAN_SMOKE_URL || 'http://127.0.0.1:3090';
const PROJECT = process.env.YODAMAN_SMOKE_PROJECT || path.resolve(__dirname, '..', '..');
// Measured, not guessed: a clean "Run CodeTrooper" completes in ~75s in two
// iterations once the prompt fits the model's context. 180s leaves generous head
// room without letting a genuinely stuck task hold the release up for minutes.
const TASK_TIMEOUT_MS = Number(process.env.YODAMAN_SMOKE_TASK_TIMEOUT || 180000);
const BOOT_TIMEOUT_MS = 45000;

const log = (msg) => process.stdout.write(`${msg}\n`);

async function reachable(url, timeoutMs = 3000) {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return response.ok;
    } catch (_err) {
        return false;
    }
}

async function waitForRuntime(deadlineMs) {
    const started = Date.now();
    while (Date.now() - started < deadlineMs) {
        if (await reachable(`${RUNTIME_URL}/api/health`, 2000)) return true;
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
}

/** Run one agent task and report what the event stream actually contained. */
async function runTask(task) {
    let body = '';
    try {
        const response = await fetch(`${RUNTIME_URL}/api/agent/task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task, projectId: PROJECT }),
            signal: AbortSignal.timeout(TASK_TIMEOUT_MS)
        });
        body = await response.text();
    } catch (err) {
        // Distinguish "the runtime went away" from "this plugin failed". A dead
        // runtime makes every remaining plugin look broken, which sends whoever
        // reads this output hunting through plugin code for a fault that is not
        // there. Observed for real: a second gate instance killed the shared
        // runtime mid-run and five plugins were reported failing.
        const stillUp = await reachable(`${RUNTIME_URL}/api/health`, 3000);
        if (!stillUp) {
            return { ok: false, fatal: true, reason: `runtime became unreachable (${err.message})` };
        }
        return { ok: false, reason: `request failed: ${err.message}` };
    }

    if (body.includes('response_truncated')) {
        return { ok: false, reason: 'response_truncated — the agent could not complete a tool call' };
    }
    if (!body.includes('"type":"tool_start"')) {
        return { ok: false, reason: 'the agent never attempted a tool call' };
    }
    return { ok: true, reason: body.includes('"type":"final_answer"') ? 'completed' : 'tool ran' };
}

async function main() {
    if (!await reachable('http://127.0.0.1:11434/api/tags')) {
        log('SKIP: Ollama is not reachable — the agent cannot be exercised here.');
        log('      This gate is meaningful only where the full local stack runs.');
        return;
    }

    let child = null;
    const alreadyUp = await reachable(`${RUNTIME_URL}/api/health`, 2000);
    if (alreadyUp) {
        log(`Using the runtime already listening at ${RUNTIME_URL}.`);
        log('If another gate run owns it, results will be unreliable — run one at a time.');
    }
    if (!alreadyUp) {
        log(`Starting a runtime for the gate at ${RUNTIME_URL}...`);
        child = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
            stdio: 'ignore',
            detached: false
        });
        if (!await waitForRuntime(BOOT_TIMEOUT_MS)) {
            child.kill('SIGKILL');
            throw new Error('Runtime did not become healthy in time.');
        }
    }

    try {
        const response = await fetch(`${RUNTIME_URL}/api/plugins`, { signal: AbortSignal.timeout(10000) });
        const payload = await response.json();
        const plugins = Array.isArray(payload) ? payload : payload.plugins || [];
        if (!plugins.length) throw new Error('No plugins are loaded — nothing to verify.');

        log(`\nDriving ${plugins.length} plugin(s) through the agent against ${PROJECT}\n`);
        const failures = [];

        for (const plugin of plugins) {
            const phrase = pluginInvocation(plugin);
            process.stdout.write(`  ${plugin.name.padEnd(20)} "${phrase}" ... `);

            // Retry once, and only on a timeout. A timeout is latency; anything
            // else is signal, and retrying signal is how a gate learns to lie.
            let result = await runTask(phrase);
            if (!result.ok && !result.fatal && /timeout/i.test(result.reason)) {
                process.stdout.write('timed out, retrying once ... ');
                result = await runTask(phrase);
            }
            log(result.ok ? `ok (${result.reason})` : `FAILED — ${result.reason}`);
            if (!result.ok) failures.push({ name: plugin.name, phrase, reason: result.reason });
            if (result.fatal) {
                log('\nAborting: the runtime is gone, so the remaining plugins cannot be judged.');
                log('Check for another runtime on this port, then re-run.');
                break;
            }
        }

        if (failures.length) {
            log('\nPlugin smoke FAILED:');
            for (const failure of failures) {
                log(`  ${failure.name}: ${failure.reason}`);
                log(`    phrase: "${failure.phrase}"`);
            }
            log('\nThe agent cannot reliably use tools. Do not ship.');
            process.exitCode = 1;
            return;
        }

        log('\nEvery plugin reached the tool path. Agent tool calls are working.');
    } finally {
        if (child) child.kill('SIGTERM');
    }
}

main().catch((err) => {
    log(`Plugin smoke errored: ${err.message}`);
    process.exitCode = 1;
});
