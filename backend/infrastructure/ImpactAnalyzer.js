/**
 * ImpactAnalyzer — blast radius for a single file, computed from the Graphify graph.
 *
 * Answers the question a diff cannot: "if I accept this write, what else is
 * affected, and is any of it covered by a test?"
 *
 * Reads `graphify-out/graph.json` directly rather than shelling out to
 * `graphify affected`, for two reasons:
 *   1. The CLI returns prose, not counts — unusable for a risk badge.
 *   2. The agent is blocked on the approval prompt while this runs, so it has
 *      to be fast and synchronous-ish. Parsing the JSON is milliseconds.
 *
 * Exports:
 *   analyzeFile(projectPath, filePath, { depth })  → impact report
 *   isTestFile(relativePath)                       → boolean
 *   summarize(report)                              → one-line human string
 */

const path = require('path');
const graphifyService = require('./GraphifyService');
const logger = require('./Logger');

// A dependent this many hops out or closer is treated as impacted. Two hops
// catches "imports the thing that imports the changed file", which is where
// most real breakage lives; beyond that the signal turns into noise.
const DEFAULT_DEPTH = 2;

// Relations that mean "A structurally depends on B". Verified against a real
// 1,951-edge graph, where the dependency edges are `calls`, `imports_from` and
// `imports`. Containment relations (`contains`, `method`, `defines`) are
// deliberately excluded — they only say a file holds a symbol, so following
// them would report every sibling in the same file as an impacted dependent.
// The extra names cover graph flavours emitted for other languages.
const DEPENDENCY_RELATIONS = new Set([
    'imports_from', 'imports', 'import',
    'calls', 'call',
    'requires', 'require',
    'extends', 'implements', 'uses', 'references', 'depends_on', 'inherits'
]);

// Containment edges are still useful in one direction: a symbol node belongs to
// its file, and a dependency on the symbol is a dependency on the file.
const CONTAINMENT_RELATIONS = new Set(['contains', 'method', 'defines']);

const TEST_PATTERNS = [
    /(^|[/\\])tests?[/\\]/i,
    /(^|[/\\])__tests__[/\\]/i,
    /\.test\.[cm]?[jt]sx?$/i,
    /\.spec\.[cm]?[jt]sx?$/i,
    /_test\.py$/i,
    /(^|[/\\])test_[^/\\]*\.py$/i
];

function isTestFile(relativePath) {
    const value = String(relativePath || '');
    return TEST_PATTERNS.some(pattern => pattern.test(value));
}

/** Normalize any path into the repo-relative, forward-slash form the graph uses. */
function toRelative(projectPath, filePath) {
    const raw = String(filePath || '');
    if (!raw) return '';
    const relative = path.isAbsolute(raw) ? path.relative(projectPath, raw) : raw;
    return relative.split(path.sep).join('/').replace(/^\.\//, '');
}

function nodeSourceFile(node) {
    return node.source_file || node.sourceFile || node.file || '';
}

/**
 * Compute the blast radius of changing `filePath`.
 *
 * Never throws: a missing or unreadable graph degrades to
 * `{ available: false }` so the approval prompt still renders.
 */
function analyzeFile(projectPath, filePath, { depth = DEFAULT_DEPTH } = {}) {
    const targetFile = toRelative(projectPath, filePath);
    const base = { available: false, targetFile, depth };

    if (!projectPath || !targetFile) {
        return { ...base, reason: 'no file path supplied' };
    }

    let graph;
    let stale = false;
    try {
        graph = graphifyService.readGraph(projectPath);
        stale = Boolean(graphifyService.freshness(projectPath, { scanSources: false }).stale);
    } catch (err) {
        logger.warn('impact_graph_unavailable', { path: projectPath, targetFile, reason: err.message });
        return { ...base, reason: 'no graph has been built for this workspace yet' };
    }

    const nodes = graph.nodes || [];
    const links = graph.links || graph.edges || [];

    // Every node that came out of the file being changed.
    const targetIds = new Set(
        nodes.filter(node => nodeSourceFile(node) === targetFile).map(node => node.id)
    );

    if (targetIds.size === 0) {
        return {
            ...base,
            stale,
            reason: stale
                ? 'file is not in the graph yet — the graph is stale'
                : 'file is not represented in the graph'
        };
    }

    const fileById = new Map(nodes.map(node => [node.id, nodeSourceFile(node)]));

    // Reverse adjacency: for each node, who depends on it.
    const dependentsOf = new Map();
    for (const link of links) {
        const relation = String(link.relation || '').toLowerCase();
        if (!DEPENDENCY_RELATIONS.has(relation)) continue;
        if (!dependentsOf.has(link.target)) dependentsOf.set(link.target, []);
        dependentsOf.get(link.target).push(link.source);
    }

    // Breadth-first outward through incoming dependency edges.
    const hopsById = new Map();
    let frontier = [...targetIds];
    for (let hop = 1; hop <= depth && frontier.length; hop += 1) {
        const next = [];
        for (const id of frontier) {
            for (const dependent of dependentsOf.get(id) || []) {
                if (targetIds.has(dependent) || hopsById.has(dependent)) continue;
                hopsById.set(dependent, hop);
                next.push(dependent);
            }
        }
        frontier = next;
    }

    // Collapse node-level hits to file-level, keeping the shortest hop count.
    const byFile = new Map();
    for (const [id, hop] of hopsById) {
        const file = fileById.get(id);
        if (!file || file === targetFile) continue;
        if (!byFile.has(file) || byFile.get(file) > hop) byFile.set(file, hop);
    }

    const dependentFiles = [...byFile.entries()]
        .map(([file, hops]) => ({ file, hops, isTest: isTestFile(file) }))
        .sort((a, b) => a.hops - b.hops || a.file.localeCompare(b.file));

    const coveringTests = dependentFiles.filter(entry => entry.isTest).map(entry => entry.file);
    const impactedFiles = dependentFiles.filter(entry => !entry.isTest);

    return {
        available: true,
        stale,
        targetFile,
        depth,
        matchedNodes: targetIds.size,
        dependentFiles,
        impactedCount: impactedFiles.length,
        testCount: coveringTests.length,
        coveringTests,
        topDependents: impactedFiles.slice(0, 5).map(entry => entry.file),
        risk: assessRisk(impactedFiles.length, coveringTests.length)
    };
}

/**
 * Risk is a function of reach and safety net: many dependents with no test
 * coverage is the case a reviewer must not wave through.
 */
function assessRisk(impactedCount, testCount) {
    if (impactedCount === 0) return 'low';
    if (testCount === 0) return impactedCount >= 5 ? 'high' : 'moderate';
    return impactedCount >= 12 ? 'moderate' : 'low';
}

/** One-line summary suitable for a log line or a compact badge. */
function summarize(report) {
    if (!report || !report.available) {
        return report?.reason ? `impact unknown — ${report.reason}` : 'impact unknown';
    }
    const files = `${report.impactedCount} dependent file${report.impactedCount === 1 ? '' : 's'}`;
    const tests = report.testCount === 0
        ? 'no covering tests'
        : `${report.testCount} covering test${report.testCount === 1 ? '' : 's'}`;
    return `${files}, ${tests}${report.stale ? ' (graph stale)' : ''}`;
}

module.exports = { analyzeFile, isTestFile, summarize, assessRisk, DEPENDENCY_RELATIONS };
