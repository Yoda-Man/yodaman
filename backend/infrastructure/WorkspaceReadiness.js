/**
 * WorkspaceReadiness — one answer to "can I trust what YodaMan tells me about
 * this workspace right now?"
 *
 * Index staleness (Context Expert), graph build state (Graphify) and spec state
 * (OpenSpec) were three unrelated signals, each surfaced in a different tab. A
 * developer could not tell which one was out of date, so a confidently wrong
 * answer looked identical to a correct one.
 *
 * This collapses them into a single graded verdict:
 *
 *   ready     — every layer is current; answers can be trusted
 *   stale     — a layer is behind the source; answers may miss recent work
 *   building  — a refresh is in flight; wait rather than re-ask
 *   unindexed — nothing has been built yet; answers will be poor
 *
 * Exports:
 *   forWorkspace(projectPath) → readiness report
 *   summarize(report)         → one-line human string
 */

const graphifyService = require('./GraphifyService');
const queueService = require('../core/QueueService');
const logger = require('./Logger');
const specDrift = require('../stardust/SpecDrift');

// Ordered worst-to-best so the overall verdict is the weakest layer.
const SEVERITY = ['unindexed', 'building', 'stale', 'ready'];

function weakest(states) {
    return states.reduce(
        (worst, state) => (SEVERITY.indexOf(state) < SEVERITY.indexOf(worst) ? state : worst),
        'ready'
    );
}

/** Graphify: is a graph present, current, or mid-build? */
function graphLayer(projectPath) {
    try {
        const freshness = graphifyService.freshness(projectPath);
        if (freshness.build && freshness.build.state === 'running') {
            return { state: 'building', detail: 'graph build in progress' };
        }
        if (!freshness.graphExists) {
            return { state: 'unindexed', detail: 'no graph has been built yet' };
        }
        if (freshness.stale) {
            return { state: 'stale', detail: 'source has changed since the last graph build' };
        }
        return { state: 'ready', detail: 'graph is current', updatedAt: freshness.graphUpdatedAt };
    } catch (err) {
        return { state: 'unindexed', detail: `graph unavailable: ${err.message}` };
    }
}

/** Context Expert: is this workspace queued or actively indexing? */
function indexLayer(projectPath) {
    try {
        const status = queueService.getStatus();
        const queued = (status.queue || []).includes(projectPath);
        if (queued) {
            return { state: 'building', detail: 'queued for reindex' };
        }
        if (status.isProcessing && status.active) {
            // The queue does not expose which path is active, so this is
            // reported as indeterminate rather than claimed as current.
            return { state: 'building', detail: 'an index job is running' };
        }
        return { state: 'ready', detail: 'no pending index work' };
    } catch (err) {
        return { state: 'ready', detail: `index state unknown: ${err.message}` };
    }
}

/**
 * Compute readiness for one workspace. Never throws — callers are health
 * endpoints and UI strips that must always render something.
 */
/**
 * The coverage finding, for a workspace whose graph is ready.
 *
 * Deliberately NOT computed in forWorkspaces(): drift costs ~160ms on a large
 * graph, and the dashboard polls the list. One workspace at a time is the
 * budget this fits in.
 *
 * The point is what a NEW user sees. Once indexing finishes, readiness used to
 * say "ready" with no action and nothing else — the moment the product finally
 * had something to say about their codebase, it said nothing. This turns that
 * moment into the finding: how much of their code is load-bearing and
 * undescribed.
 *
 * @param {string} projectPath
 * @param {string} state - Only 'ready' is worth measuring; before that there is
 *   no graph to measure against.
 */
function coverageFor(projectPath, state) {
    if (state !== 'ready') return null;
    try {
        const drift = specDrift.detectDrift(projectPath);
        if (!drift?.available) return null;

        return {
            covered: drift.covered,
            specCount: drift.specCount,
            undocumentedCount: drift.undocumentedCount,
            staleCount: drift.staleCount,
            // The few worth naming. A list of twenty is a report; three is a
            // place to start.
            hubs: (drift.undocumented || []).slice(0, 3),
            headline: drift.covered
                ? `${drift.staleCount} stale spec reference(s), ${drift.undocumentedCount} module(s) no spec describes`
                : `${drift.undocumentedCount} load-bearing module(s) carry this codebase, and nothing describes them`
        };
    } catch (_err) {
        // Coverage is an enhancement to readiness, never a reason it fails.
        return null;
    }
}

function forWorkspace(projectPath, { withCoverage = false } = {}) {
    if (!projectPath) {
        return { path: null, state: 'unindexed', layers: {}, reason: 'no workspace selected' };
    }

    const layers = {
        graph: graphLayer(projectPath),
        index: indexLayer(projectPath)
    };

    const state = weakest(Object.values(layers).map(layer => layer.state));

    // Only the graph is authoritative about whether an answer is current, so it
    // drives the actionable hint.
    const action = {
        unindexed: 'Run Sync Repository to build the knowledge graph.',
        stale: 'Run Sync Repository to refresh the graph before relying on answers.',
        building: 'A refresh is in flight — results will improve shortly.',
        ready: null
    }[state];

    const coverage = withCoverage ? coverageFor(projectPath, state) : null;

    return {
        path: projectPath,
        state,
        trustworthy: state === 'ready',
        layers,
        // Once the graph is ready there is no setup step left to name, so the
        // finding takes the slot the setup hint used to occupy.
        action: action || (coverage ? coverage.headline : null),
        coverage
    };
}

function summarize(report) {
    if (!report) return 'workspace readiness unknown';
    const labels = {
        ready: 'ready',
        stale: 'stale — answers may miss recent changes',
        building: 'refreshing',
        unindexed: 'not indexed yet'
    };
    return labels[report.state] || report.state;
}

/** Readiness for many workspaces, plus the weakest state across all of them. */
function forWorkspaces(projectPaths = []) {
    // No coverage here on purpose — see coverageFor(). The list is polled.
    const workspaces = projectPaths.map((p) => forWorkspace(p));
    const overall = workspaces.length ? weakest(workspaces.map(w => w.state)) : 'unindexed';

    if (overall !== 'ready') {
        logger.info('workspace_readiness_degraded', {
            overall,
            degraded: workspaces.filter(w => w.state !== 'ready').map(w => ({ path: w.path, state: w.state }))
        });
    }

    return { overall, trustworthy: overall === 'ready', workspaces };
}

module.exports = { forWorkspace, forWorkspaces, summarize, weakest, SEVERITY };
