/**
 * GraphRanker — blends Context Expert's semantic ranking with Graphify structure
 * and OpenSpec spec coverage.
 *
 * Three signals alone each have blind spots:
 *
 *   - Semantic-only surfaces a changelog entry above the module it describes.
 *   - Graph-only surfaces the most-imported file for every query.
 *   - Spec-only can't find anything not already documented.
 *
 * The blend makes search Stardust-powered: every result is ranked by what
 * Context Expert knows (semantic relevance), what Graphify knows (structural
 * proximity and centrality), and what OpenSpec knows (is this file described
 * by the architecture?).
 *
 * Semantic score stays dominant so a strong textual match is never buried.
 *
 * Exports:
 *   rerank(projectPath, results, { activeFile, weights }) → reordered results
 *   buildIndex(projectPath)                               → graph lookup tables
 *   buildSpecIndex(projectPath)                           → spec coverage lookup
 */

const path = require('path');
const graphifyService = require('./GraphifyService');
const specDrift = require('../stardust/SpecDrift');
const logger = require('./Logger');
const { DEPENDENCY_RELATIONS } = require('./ImpactAnalyzer');

// Semantic dominates; spec coverage and proximity to what you're editing matter
// more than raw popularity.
const DEFAULT_WEIGHTS = { semantic: 0.50, proximity: 0.20, centrality: 0.15, specCoverage: 0.15 };

// How far to walk from the active file before proximity contributes nothing.
const MAX_PROXIMITY_HOPS = 3;

function toRelative(projectPath, filePath) {
    const raw = String(filePath || '');
    if (!raw) return '';
    const relative = path.isAbsolute(raw) ? path.relative(projectPath, raw) : raw;
    return relative.split(path.sep).join('/').replace(/^\.\//, '');
}

function nodeSourceFile(node) {
    return node.source_file || node.sourceFile || node.file || '';
}

function resultPath(result) {
    return result?.metadata?.path || result?.path || result?.file || '';
}

/**
 * Build per-file degree counts and an undirected adjacency map of files.
 * Returns null when no usable graph exists.
 */
function buildIndex(projectPath) {
    let graph;
    try {
        graph = graphifyService.readGraph(projectPath);
    } catch (err) {
        return null;
    }

    const nodes = graph.nodes || [];
    const links = graph.links || graph.edges || [];
    if (nodes.length === 0) return null;

    const fileById = new Map(nodes.map(node => [node.id, nodeSourceFile(node)]));
    const degreeByFile = new Map();
    const neighbours = new Map();

    const connect = (a, b) => {
        if (!neighbours.has(a)) neighbours.set(a, new Set());
        neighbours.get(a).add(b);
    };

    for (const link of links) {
        const relation = String(link.relation || '').toLowerCase();
        if (!DEPENDENCY_RELATIONS.has(relation)) continue;

        const from = fileById.get(link.source);
        const to = fileById.get(link.target);
        if (!from || !to || from === to) continue;

        degreeByFile.set(from, (degreeByFile.get(from) || 0) + 1);
        degreeByFile.set(to, (degreeByFile.get(to) || 0) + 1);
        // Undirected for proximity: "related to what I'm editing" runs both ways.
        connect(from, to);
        connect(to, from);
    }

    const maxDegree = Math.max(1, ...degreeByFile.values());
    return { degreeByFile, neighbours, maxDegree, fileCount: degreeByFile.size };
}

/** Breadth-first hop distance from `origin` to every reachable file. */
function hopDistances(index, origin, maxHops = MAX_PROXIMITY_HOPS) {
    const distances = new Map([[origin, 0]]);
    let frontier = [origin];

    for (let hop = 1; hop <= maxHops && frontier.length; hop += 1) {
        const next = [];
        for (const file of frontier) {
            for (const neighbour of index.neighbours.get(file) || []) {
                if (distances.has(neighbour)) continue;
                distances.set(neighbour, hop);
                next.push(neighbour);
            }
        }
        frontier = next;
    }
    return distances;
}

/**
 * Build a spec-coverage index: Set of files referenced in OpenSpec specs.
 * Files described by specs get a ranking boost — they have recorded intent.
 */
function buildSpecIndex(projectPath) {
    try {
        const specs = specDrift.readSpecs(projectPath);
        if (!specs || specs.length === 0) return null;
        const covered = new Set();
        for (const spec of specs) {
            const refs = specDrift.extractReferences(spec.text);
            for (const ref of refs) covered.add(ref);
        }
        return covered.size > 0 ? covered : null;
    } catch (_) {
        return null;
    }
}

/**
 * Reorder search results using graph structure and spec coverage.
 *
 * Never throws and never drops results: with no graph, or no graph coverage for
 * the hits, the input order is returned untouched.
 */
function rerank(projectPath, results, { activeFile, weights } = {}) {
    const list = Array.isArray(results) ? results : [];
    if (!projectPath || list.length < 2) return list;

    const index = buildIndex(projectPath);
    if (!index) return list;

    const w = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
    const activeRelative = activeFile ? toRelative(projectPath, activeFile) : '';
    const distances = activeRelative && index.neighbours.has(activeRelative)
        ? hopDistances(index, activeRelative)
        : null;

    // Build spec-coverage index: which files are documented in OpenSpec specs.
    const specIndex = buildSpecIndex(projectPath);

    // Normalize semantic scores into 0..1 so the weights mean something even
    // when the provider returns raw distances or a flat constant.
    const scores = list.map(item => Number(item?.score) || 0);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const span = maxScore - minScore;

    let graphMatched = 0;

    const scored = list.map((item, position) => {
        const file = toRelative(projectPath, resultPath(item));
        const semantic = span > 0 ? (scores[position] - minScore) / span : 0.5;

        const degree = index.degreeByFile.get(file);
        const centrality = degree ? degree / index.maxDegree : 0;

        let proximity = 0;
        if (distances) {
            const hops = distances.get(file);
            if (hops !== undefined) {
                // hops 0 → 1.0, and decaying to 0 at MAX_PROXIMITY_HOPS.
                proximity = Math.max(0, 1 - hops / MAX_PROXIMITY_HOPS);
            }
        }

        if (degree !== undefined) graphMatched += 1;

        // Spec coverage: 1.0 if the file is cited in any OpenSpec spec, 0 otherwise.
        const specCoverage = specIndex && specIndex.has(file) ? 1.0 : 0;

        return {
            item,
            position,
            file,
            blended: (w.semantic * semantic) + (w.proximity * proximity) + (w.centrality * centrality) + (w.specCoverage * specCoverage),
            signal: {
                semantic: Number(semantic.toFixed(3)),
                centrality: Number(centrality.toFixed(3)),
                proximity: Number(proximity.toFixed(3)),
                specCoverage: Number(specCoverage.toFixed(3)),
                hops: distances?.get(file) ?? null,
                inGraph: degree !== undefined,
                weights: w
            }
        };
    });

    // If the graph knows nothing about these hits, reordering would be noise.
    if (graphMatched === 0) return list;

    scored.sort((a, b) => (b.blended - a.blended) || (a.position - b.position));

    logger.info('search_graph_reranked', {
        path: projectPath,
        results: list.length,
        graphMatched,
        activeFile: activeRelative || null,
        reordered: scored.some((entry, position) => entry.position !== position)
    });

    return scored.map(entry => ({
        ...entry.item,
        graphSignal: entry.signal,
        graphRank: Number(entry.blended.toFixed(4))
    }));
}

module.exports = { rerank, buildIndex, buildSpecIndex, DEFAULT_WEIGHTS, MAX_PROXIMITY_HOPS };
