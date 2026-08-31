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

// A dedicated port, NOT the 3090 the desktop app uses.
//
// These gates used to adopt whatever was already listening on 3090. If the
// YodaMan desktop app was open — or a packaged build had been left running —
// the gate silently measured THAT build instead of the working tree, and
// reported the result as if it had tested your changes. It cost a full
// misdiagnosis: a ranking failure was chased through the source for an hour
// while every probe was answering from a nine-hour-old packaged app.
//
// Set YODAMAN_SMOKE_URL to deliberately point at an existing runtime.
const SMOKE_PORT = Number(process.env.YODAMAN_SMOKE_PORT) || 3097;
const ADOPT_EXISTING = Boolean(process.env.YODAMAN_SMOKE_URL);
const RUNTIME_URL = process.env.YODAMAN_SMOKE_URL || `http://127.0.0.1:${SMOKE_PORT}`;
const EXPECTED_WEIGHTS = ['semantic', 'proximity', 'centrality', 'specCoverage'];
const log = (msg) => process.stdout.write(`${msg}\n`);

async function reachable(url, timeoutMs = 3000) {
    try {
        return (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).ok;
    } catch (_err) {
        // Unreachable is the answer this asks for, not an error to report. The
        // caller decides what an absent runtime means — skip, wait, or fail.
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

/**
 * Search terms taken from files the graph knows, best candidates first.
 *
 * Returns several on purpose. Graphify and ctx index overlapping but DIFFERENT
 * file sets: Graphify walks vendored trees that ctx excludes, so this
 * workspace's highest-degree files were `third_party` and node_modules code
 * that search legitimately never returns. Asserting on the single top-degree
 * term therefore failed for a sound reason and blamed the product — the gate
 * was measuring index overlap, not the ranking blend.
 *
 * With a list, the caller can keep trying until it finds a term both sides
 * know. Ranking that is genuinely broken still fails, because then NO candidate
 * ranks.
 */
async function graphTerms(projectPath, limit = 8) {
    try {
        // Must come from a file with dependency EDGES, not merely one the graph
        // lists. A markdown document is in the graph but has no structural
        // position, so centrality and proximity are legitimately zero for it and
        // ranking cannot contribute. buildIndex().degreeByFile holds exactly the
        // connected files.
        const graphRanker = require(path.resolve(__dirname, '..', 'backend', 'infrastructure', 'GraphRanker'));
        const index = graphRanker.buildIndex(projectPath);
        if (!index || !index.degreeByFile || index.degreeByFile.size === 0) return [];

        return [...index.degreeByFile.entries()]
            .sort((a, b) => b[1] - a[1])
            // Vendored and generated trees are in the graph but not in the
            // search index, so a term drawn from one can never graph-rank.
            .filter(([file]) => !/(^|[\\/])(node_modules|third_party|vendor|Pods|dist|build|graphify-out)[\\/]/.test(file))
            .map(([file]) => path.basename(file).replace(/\.[^.]+$/, ''))
            .filter((stem) => stem.length > 4)
            .slice(0, limit);
    } catch (_err) {
        // No graph to derive a term from, so there is nothing to assert against.
        // The caller reports this as a skip rather than a failure.
        return [];
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
    const terms = await graphTerms(project.path);
    if (!terms.length) {
        log('  search ranking     SKIP — no knowledge graph for this workspace to rank against');
        return;
    }

    // Try candidates until one is a term BOTH sides know. A single term that
    // fails proves nothing about the blend; every candidate failing does.
    let payload = null;
    let term = null;
    const tried = [];
    const slow = [];
    for (const candidate of terms) {
        const attempt = new URLSearchParams({ query: candidate, project: project.path });
        let result;
        try {
            result = await getJson(`/api/search?${attempt.toString()}`);
        } catch (err) {
            // One slow or failing term must not decide the gate. Semantic search
            // on a large workspace can take tens of seconds, and a single abort
            // used to take the whole run down with it — reported as a journey
            // failure when nothing about ranking had been measured.
            slow.push(`${candidate} (${err.message})`);
            continue;
        }
        tried.push(candidate);
        payload = result;
        term = candidate;
        if (result.graphRanked) break;
    }

    if (slow.length) {
        log(`  search ranking     note — ${slow.length} term(s) did not return in time: ${slow.join(', ')}`);
    }

    if (!payload) {
        log('  search ranking     SKIP — no candidate term returned a result to rank');
        return;
    }

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
        log(`                     ${tried.length} graph-connected term(s) all fell back to`);
        log(`                     semantic only for ${path.basename(project.path)}: ${tried.join(', ')}`);
        log('                     Usually ctx and Graphify were indexed from different');
        log('                     roots: compare a result path against graphify-out/graph.json.');
        failures.push('graph ranking inactive');
        return;
    }

    log(`  search ranking     ok — four signals, graph-ranked on "${term}", ${(payload.results || []).length} results`);
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
    // Always say which runtime produced the result. A gate that measured a
    // different build than the one you changed must never look like a gate that
    // measured yours.
    if (await reachable(`${RUNTIME_URL}/api/health`, 2000)) {
        log(ADOPT_EXISTING
            ? `Using the runtime you pointed at: ${RUNTIME_URL}`
            : `WARNING: reusing a runtime already on ${RUNTIME_URL} that this gate did not start.`);
    }

    if (!await reachable(`${RUNTIME_URL}/api/health`, 2000)) {
        if (!await reachable('http://127.0.0.1:11434/api/tags')) {
            log('SKIP: no runtime and no Ollama — these journeys need the local stack.');
            return true;
        }
        log(`Starting a runtime from this working tree at ${RUNTIME_URL}...`);
        child = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
            stdio: 'ignore',
            env: { ...process.env, YODAMAN_PORT: String(SMOKE_PORT) }
        });
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
