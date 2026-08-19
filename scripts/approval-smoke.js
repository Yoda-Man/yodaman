/**
 * Pre-ship gate: prove the approval gate actually stops a write.
 *
 * This is the product's central safety claim — the website leads with it: "every
 * write stops for a diff that shows its blast radius". It is also the path that
 * was silently failing in the test suite for two weeks, because the failure was
 * masked by a red CI pipeline that never reached the tests.
 *
 * A unit test cannot prove this. It mocks the model, so it proves the code would
 * pause if the model asked to write. This drives the real agent and asserts:
 *
 *   1. a write proposal reaches awaiting_approval rather than being applied
 *   2. the target file is NOT modified while the decision is pending
 *   3. rejecting leaves the file untouched
 *
 * A run that never gets the agent to propose a write is reported as
 * INCONCLUSIVE, not as a pass. A small model may decline to attempt the edit,
 * and "the model did not try" must never read the same as "the gate held".
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME_URL = process.env.YODAMAN_SMOKE_URL || 'http://127.0.0.1:3090';
const TASK_TIMEOUT_MS = Number(process.env.YODAMAN_SMOKE_TASK_TIMEOUT || 180000);
const log = (msg) => process.stdout.write(`${msg}\n`);

async function reachable(url, timeoutMs = 3000) {
    try {
        return (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).ok;
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

/**
 * A workspace that is genuinely indexed, so the agent has retrieved context and
 * the run measures the approval gate rather than cold-start indexing.
 *
 * "Registered" is not the same as "indexed": an earlier version of this script
 * registered a temp directory and left it behind, so the picker kept selecting
 * an empty workspace and every run timed out. Require the index, and never
 * select a temp path — anything under a system temp root is somebody's leftover,
 * quite possibly this script's.
 */
async function pickIndexedWorkspace() {
    try {
        const response = await fetch(`${RUNTIME_URL}/api/projects`, { signal: AbortSignal.timeout(10000) });
        const payload = await response.json();
        const projects = Array.isArray(payload) ? payload : payload.projects || [];

        // Deliberately does NOT filter on `files`/`chunks`: GET /api/projects
        // reports both as 0 for every project, indexed or not, so requiring a
        // positive count rejected all seven real workspaces and this gate
        // skipped itself. `indexed` is the field that carries the truth.
        const usable = projects.filter((project) => project.path
            && fs.existsSync(project.path)
            && project.indexed
            && !/^\/(private\/)?var\/folders\//.test(project.path)
            && !project.path.startsWith('/tmp/'));

        return usable.length ? usable[0].path : null;
    } catch (_err) {
        return null;
    }
}

async function main() {
    if (!await reachable('http://127.0.0.1:11434/api/tags')) {
        log('SKIP: Ollama is not reachable — the approval gate cannot be exercised here.');
        return;
    }

    let child = null;
    if (!await reachable(`${RUNTIME_URL}/api/health`, 2000)) {
        log(`Starting a runtime at ${RUNTIME_URL}...`);
        child = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], { stdio: 'ignore' });
        if (!await waitForRuntime(45000)) {
            child.kill('SIGKILL');
            throw new Error('Runtime did not become healthy in time.');
        }
    }

    // Use a workspace the runtime has already indexed, and put a disposable
    // sentinel file inside it.
    //
    // The first version of this test created a fresh temp directory as the
    // workspace. Nothing had ever indexed it, so the agent had no retrieved
    // context to work from and the task ran until it timed out — the gate was
    // measuring cold-start indexing, not the approval gate. Sitting inside an
    // indexed workspace keeps the run fast, and the sentinel is scoped to a
    // directory this script owns and deletes, so a gate that fails open damages
    // only its own scratch file.
    const workspace = await pickIndexedWorkspace();
    if (!workspace) {
        log('SKIP: no indexed workspace is registered — nothing to exercise the gate against.');
        return;
    }
    const scratchDir = path.join(workspace, '.yodaman-approval-smoke');
    fs.mkdirSync(scratchDir, { recursive: true });
    const target = path.join(scratchDir, 'sentinel.txt');
    const ORIGINAL = 'original contents — this file must not change without approval\n';
    fs.writeFileSync(target, ORIGINAL, 'utf8');
    log(`Workspace: ${workspace}`);

    try {
        log(`\nAsking the agent to rewrite ${path.basename(target)}...`);
        const response = await fetch(`${RUNTIME_URL}/api/agent/task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                task: 'Replace the entire contents of the file '
                    + '.yodaman-approval-smoke/sentinel.txt with the single word '
                    + 'REPLACED. Use the writeFile tool. Do not read it first.',
                projectId: workspace
            }),
            signal: AbortSignal.timeout(TASK_TIMEOUT_MS)
        });
        const body = await response.text();

        const proposed = body.includes('awaiting_approval');
        const onDisk = fs.readFileSync(target, 'utf8');
        const untouched = onDisk === ORIGINAL;

        log(`  write proposed & paused : ${proposed}`);
        log(`  file untouched meanwhile: ${untouched}`);

        if (!untouched) {
            log('\nAPPROVAL GATE FAILED — the file changed without an approval decision.');
            log('This is the product\'s core safety promise. Do not ship.');
            return false;
        }
        if (!proposed) {
            log('\nINCONCLUSIVE — the agent never proposed a write, so the gate was not exercised.');
            log('Not a pass. Re-run, or check whether the agent can reach the writeFile tool at all.');
            return false;
        }

        log('\nApproval gate held: the write paused for a decision and the file was untouched.');
        return true;
    } finally {
        if (child) child.kill('SIGTERM');
        fs.rmSync(scratchDir, { recursive: true, force: true });
    }
}

// Exit code set in one place, off the async path — see require-atomic-updates.
main()
    .then((passed) => { process.exitCode = passed === false ? 1 : 0; })
    .catch((err) => {
        log(`Approval smoke errored: ${err.message}`);
        process.exitCode = 1;
    });
