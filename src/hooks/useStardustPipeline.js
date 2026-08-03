/**
 * useStardustPipeline — the three-tool state Stardust is built on, fetched once.
 *
 * Context Expert, Graphify and OpenSpec are all mandatory, so their combined
 * state is not a per-tab concern: the pipeline strip renders it on every tab, the
 * Trust tab expands it, and the Drift tab is its cross-tool product. Fetching it
 * per panel meant three tabs each asking the same questions and disagreeing about
 * the answers.
 *
 * The layer states come straight from WorkspaceReadiness rather than being
 * re-derived from whether a CLI happens to be installed — an installed Graphify
 * with no graph built is not "ready", and saying so was the old bug.
 *
 * Usage:
 *   const { pipeline, loading, refresh } = useStardustPipeline(projectRoot);
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/api';

// Worst-to-best, matching the backend. The overall verdict is the weakest layer.
const SEVERITY = ['unindexed', 'unavailable', 'building', 'stale', 'ready'];

function weakest(states) {
    return states.reduce(
        (worst, state) => (SEVERITY.indexOf(state) < SEVERITY.indexOf(worst) ? state : worst),
        'ready'
    );
}

const EMPTY = {
    loaded: false,
    health: null,
    readiness: null,
    drift: null,
    layers: {
        ctx: { state: 'unindexed', detail: 'not checked yet', version: null },
        graph: { state: 'unindexed', detail: 'not checked yet', version: null },
        spec: { state: 'unindexed', detail: 'not checked yet', version: null },
    },
    overall: 'unindexed',
    reason: 'not checked yet',
    action: null,
};

/**
 * OpenSpec has no readiness layer of its own — the CLI being reachable is only
 * half the question, the other half is whether any specs exist to reason about.
 * Drift availability answers that, so the two are combined here.
 */
function specLayer(health, drift) {
    const check = health?.checks?.openspec;
    const version = check?.version || null;

    if (check?.ok === false) {
        return { state: 'unindexed', detail: check.message || 'OpenSpec CLI is not installed', version };
    }
    if (check?.ok === null || check?.ok === undefined) {
        return { state: 'building', detail: check?.message || 'checking OpenSpec', version };
    }
    if (drift && drift.available === false) {
        // The reason distinguishes "not initialized" from "initialized but empty";
        // neither is ready, and both are actionable.
        return { state: 'stale', detail: drift.reason || 'no specs written yet', version };
    }
    if (drift?.available) {
        return {
            state: drift.inSync ? 'ready' : 'stale',
            detail: drift.inSync
                ? `${drift.specCount} spec${drift.specCount === 1 ? '' : 's'} agree with the code`
                : `${drift.staleCount} stale reference${drift.staleCount === 1 ? '' : 's'}, ${drift.undocumentedCount} undocumented module${drift.undocumentedCount === 1 ? '' : 's'}`,
            version,
        };
    }
    return { state: 'ready', detail: 'CLI installed and reachable', version };
}

export function useStardustPipeline(projectRoot) {
    const [state, setState] = useState(EMPTY);
    const [loading, setLoading] = useState(false);
    const requestSeq = useRef(0);

    const refresh = useCallback(async () => {
        if (!projectRoot) {
            setState(EMPTY);
            return;
        }

        const seq = ++requestSeq.current;
        setLoading(true);

        // Each call degrades independently: one missing tool must not blank the
        // other two, which is the whole point of showing them side by side.
        const [health, readiness, drift] = await Promise.all([
            api.health().catch(() => null),
            api.getReadiness(projectRoot).catch(() => null),
            api.stardustDrift(projectRoot).catch(() => null),
        ]);

        // A newer refresh already landed — drop this one rather than overwrite it.
        if (seq !== requestSeq.current) return;

        const ctx = readiness?.layers?.index
            ? { ...readiness.layers.index, version: health?.checks?.ctx?.version || null }
            : { state: 'unindexed', detail: health?.checks?.ctx?.message || 'index state unknown', version: health?.checks?.ctx?.version || null };

        const graph = readiness?.layers?.graph
            ? { ...readiness.layers.graph, version: health?.checks?.graphify?.version || null }
            : { state: 'unindexed', detail: health?.checks?.graphify?.message || 'no graph has been built yet', version: health?.checks?.graphify?.version || null };

        const spec = specLayer(health, drift);
        const overall = weakest([ctx.state, graph.state, spec.state]);

        // Name the layer that set the verdict, so "degraded" is never unexplained.
        const culprit = [
            ['Context Expert', ctx],
            ['Graphify', graph],
            ['OpenSpec', spec],
        ].find(([, layer]) => layer.state === overall);

        setState({
            loaded: true,
            health,
            readiness,
            drift,
            layers: { ctx, graph, spec },
            overall,
            reason: culprit ? `${culprit[0]}: ${culprit[1].detail}` : 'all three tools are current',
            action: readiness?.action || null,
        });
        setLoading(false);
    }, [projectRoot]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { pipeline: state, loading, refresh };
}

export { weakest, SEVERITY };
