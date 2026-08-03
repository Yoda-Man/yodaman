/**
 * GraphRanker — blends Context Expert's semantic ranking with Graphify structure.
 *
 * Embedding similarity finds files that *talk like* the query. Graph structure
 * finds files that are *connected to* what you are working on. Neither is
 * sufficient alone:
 *
 *   - Semantic-only surfaces a changelog entry above the module it describes.
 *   - Graph-only surfaces the most-imported file for every query.
 *
 * Semantic score stays dominant so a strong textual match is never buried;
 * structure breaks ties and nudges. That matters in practice because the ctx
 * filesystem fallback returns a flat score for every hit, leaving retrieval
 * with no opinion at all about ordering.
 *
 * Exports:
 *   rerank(projectPath, results, { activeFile, weights }) → reordered results
 *   buildIndex(projectPath)                               → graph lookup tables
 */

const path = require('path');
const graphifyService = require('./GraphifyService');
const logger = require('./Logger');
const { DEPENDENCY_RELATIONS } = require('./ImpactAnalyzer');

// Semantic dominates; proximity to what you're editing matters more than raw
// popularity, because a highly-central file is relevant to every query.
const DEFAULT_WEIGHTS = { semantic: 0.6, proximity: 0.25, centrality: 0.15 };

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
 * Reorder search results using graph structure.
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

        return {
            item,
            position,
            file,
            blended: (w.semantic * semantic) + (w.proximity * proximity) + (w.centrality * centrality),
            signal: {
                centrality: Number(centrality.toFixed(3)),
                proximity: Number(proximity.toFixed(3)),
                hops: distances?.get(file) ?? null,
                inGraph: degree !== undefined
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

module.exports = { rerank, buildIndex, DEFAULT_WEIGHTS, MAX_PROXIMITY_HOPS };
