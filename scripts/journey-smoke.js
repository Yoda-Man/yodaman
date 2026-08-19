/**
 * Pre-ship gate for the journeys that do not need the agent loop.
 *
 * Fast and deterministic, unlike the plugin and approval gates: these are plain
 * HTTP checks against the runtime, so they are cheap enough to run often and
 * they do not depend on a model deciding anything.
 *
 * What they cover, and why each is here:
 *
 *   search ranking   The product's headline claim is that every result blends
 *                    four signals. The API advertises the weights whether or not
 *                    the blend was applied, so a caller cannot tell a real blend
 *                    from a silent fallback. This asserts the weights are the
 *                    documented four AND that ranking was actually active.
 *
 *   readiness        The loop support fields most often: a workspace reports its
 *                    graph and index state, and every stale one carries a
 *                    remediation the user can act on. A state with no action is
 *                    a dead end for whoever is on the other end of the ticket.
 *
 * Exit codes: 0 all passed, 1 a check failed, 0 with SKIP when no runtime.
 */
const { spawn } = require('child_process');
const path = require('path');

const RUNTIME_URL = process.env.YODAMAN_SMOKE_URL || 'http://127.0.0.1:3090';
const EXPECTED_WEIGHTS = ['semantic', 'proximity', 'centrality', 'specCoverage'];
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

async function getJson(pathname, timeoutMs = 90000) {
    const response = await fetch(`${RUNTIME_URL}${pathname}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${pathname}`);
    return response.json();
}

/** A search term taken from a file the graph knows, so a match is expected. */
async function graphTerm(projectPath) {
    try {
        // Must come from a file with dependency EDGES, not merely one the graph
        // lists. A markdown document is in the graph but has no structural
        // position, so centrality and proximity are legitimately zero for it and
        // ranking cannot contribute — asserting graphRanked on a docs hit fails
        // for a sound reason. buildIndex().degreeByFile holds exactly the
        // connected files.
        const graphRanker = require(path.resolve(__dirname, '..', 'backend', 'infrastructure', 'GraphRanker'));
        const index = graphRanker.buildIndex(projectPath);
        if (!index || !index.degreeByFile || index.degreeByFile.size === 0) return null;

        const connected = [...index.degreeByFile.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([file]) => path.basename(file).replace(/\.[^.]+$/, ''))
            .filter((stem) => stem.length > 4);
        return connected[0] || null;
    } catch (_err) {
        return null;
    }
}

async function checkSearchRanking(failures) {
    const projects = await getJson('/api/projects', 15000);
    const list = Array.isArray(projects) ? projects : projects.projects || [];
    const project = list.find((p) => p.indexed && Number(p.files) > 0);
    if (!project) {
        log('  search ranking     SKIP — no indexed workspace with files to search');
        return;
    }

    // Query for something the graph demonstrably contains, rather than a word
    // picked at random. An arbitrary query can legitimately return hits that are
    // not in the graph — ctx and Graphify index overlapping but different file
    // sets — and asserting graphRanked on those would fail for a sound reason.
    // Deriving the term from a graph file makes a match the expected outcome, so
    // a failure means the blend is genuinely not working.
    const term = await graphTerm(project.path);
    if (!term) {
        log('  search ranking     SKIP — no knowledge graph for this workspace to rank against');
        return;
    }

    const params = new URLSearchParams({ query: term, project: project.path });
    const payload = await getJson(`/api/search?${params.toString()}`);
    const weights = payload.weights || {};

    const missing = EXPECTED_WEIGHTS.filter((signal) => typeof weights[signal] !== 'number');
    if (missing.length) {
        log(`  search ranking     FAILED — weights missing: ${missing.join(', ')}`);
        failures.push('search weights incomplete');
        return;
    }

    const total = EXPECTED_WEIGHTS.reduce((sum, signal) => sum + weights[signal], 0);
    if (Math.abs(total - 1) > 0.001) {
        log(`  search ranking     FAILED — weights sum to ${total}, not 1`);
        failures.push('search weights do not sum to 1');
        return;
    }

    if (!payload.graphRanked) {
        // Not a cosmetic failure: the product advertises a four-signal blend and
        // is returning semantic-only ordering while still reporting the weights.
        log('  search ranking     FAILED — weights advertised but graphRanked=false');
        log(`                     ranking fell back to semantic only for ${path.basename(project.path)}.`);
        log('                     Usually ctx and Graphify were indexed from different');
        log('                     roots: compare a result path against graphify-out/graph.json.');
        failures.push('graph ranking inactive');
        return;
    }

    log(`  search ranking     ok — four signals, graph-ranked, ${(payload.results || []).length} results`);
}

async function checkReadiness(failures) {
    const readiness = await getJson('/api/readiness', 60000);
    const workspaces = readiness.workspaces || [];
    if (!workspaces.length) {
        log('  readiness          SKIP — no workspaces registered');
        return;
    }

    const shapeless = workspaces.filter((w) => !w.state || !w.layers || !w.layers.graph || !w.layers.index);
    if (shapeless.length) {
        log(`  readiness          FAILED — ${shapeless.length} workspace(s) missing state or layers`);
        failures.push('readiness shape incomplete');
        return;
    }

    // A workspace that is not ready must tell the user what to do about it.
    const unactionable = workspaces.filter((w) => w.state !== 'ready' && !w.action);
    if (unactionable.length) {
        log(`  readiness          FAILED — ${unactionable.length} non-ready workspace(s) carry no remediation`);
        unactionable.slice(0, 3).forEach((w) => log(`                     ${w.state}: ${w.path}`));
        failures.push('readiness missing remediation');
        return;
    }

    const states = workspaces.reduce((acc, w) => {
        acc[w.state] = (acc[w.state] || 0) + 1;
        return acc;
    }, {});
    log(`  readiness          ok — ${workspaces.length} workspace(s): ${Object.entries(states).map(([k, v]) => `${v} ${k}`).join(', ')}`);
}

async function main() {
    let child = null;
    if (!await reachable(`${RUNTIME_URL}/api/health`, 2000)) {
        if (!await reachable('http://127.0.0.1:11434/api/tags')) {
            log('SKIP: no runtime and no Ollama — these journeys need the local stack.');
            return true;
        }
        log(`Starting a runtime at ${RUNTIME_URL}...`);
        child = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], { stdio: 'ignore' });
        if (!await waitForRuntime(45000)) {
            child.kill('SIGKILL');
            throw new Error('Runtime did not become healthy in time.');
        }
    }

    const failures = [];
    try {
        log('');
        await checkSearchRanking(failures);
        await checkReadiness(failures);
    } finally {
        if (child) child.kill('SIGTERM');
    }

    if (failures.length) {
        log(`\nJourney checks FAILED: ${failures.join('; ')}`);
        return false;
    }
    log('\nAll journey checks passed.');
    return true;
}

main()
    .then((passed) => { process.exitCode = passed === false ? 1 : 0; })
    .catch((err) => {
        log(`Journey smoke errored: ${err.message}`);
        process.exitCode = 1;
    });
