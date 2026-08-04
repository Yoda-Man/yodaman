/**
 * GraphFacts — workspace-wide structural queries over the Graphify graph.
 *
 * Companion to ImpactAnalyzer: that answers "what does changing X reach", this
 * answers questions about the workspace as a whole. Built because the shipped
 * plugins were each re-deriving structure from the filesystem with regex while
 * a properly resolved import graph sat unused in the same process.
 *
 * One graph read serves every fact below.
 *
 * Exports:
 *   load(projectPath)                → { files, degree, dependsOn, dependedOnBy }
 *   orphanFiles(projectPath, opts)   → files nothing imports (dead code)
 *   coverageByFile(projectPath, opts)→ Map<file, testFiles[]>
 *   centralFiles(projectPath, opts)  → busiest files, most connected first
 */

const path = require('path');
const graphifyService = require('./GraphifyService');
const { DEPENDENCY_RELATIONS, isTestFile } = require('./ImpactAnalyzer');
const logger = require('./Logger');

// Files that are legitimately imported by nothing: process entry points, config,
// and anything a bundler or runtime loads by convention rather than by import.
const ENTRY_PATTERNS = [
    /^(server|start|main|index|app)\.[cm]?[jt]sx?$/i,
    /^src[/\\](main|index|App)\.[cm]?[jt]sx?$/i,
    /^bin[/\\]/i,
    /^scripts[/\\]/i,
    /^(tailwind|postcss|vite|jest|babel|webpack|rollup|eslint)\.config\./i,
    /^plugins[/\\]/i,                          // loaded dynamically by ToolBox
    // Host-launched process entry points. Nothing in the repo imports these —
    // Electron launches main/preload, and VS Code loads the extension through
    // its package.json "main". Without these they read as dead code.
    /^electron[/\\](main|preload)\.[cm]?js$/i,
    /^extensions[/\\][^/\\]+[/\\]src[/\\]extension\.[cm]?[jt]s$/i,
    /^apps[/\\][^/\\]+[/\\]App\.[cm]?[jt]sx?$/i, // React Native / Expo entry
    /\.d\.ts$/i
];

function nodeSourceFile(node) {
    return node.source_file || node.sourceFile || node.file || '';
}

function isEntryPoint(relativePath) {
    return ENTRY_PATTERNS.some(pattern => pattern.test(relativePath));
}

function toRelative(projectPath, filePath) {
    const raw = String(filePath || '');
    if (!raw) return '';
    const relative = path.isAbsolute(raw) ? path.relative(projectPath, raw) : raw;
    return relative.split(path.sep).join('/').replace(/^\.\//, '');
}

/**
 * Read the graph once and build file-level adjacency in both directions.
 * Returns null when no usable graph exists — callers fall back rather than fail.
 */
function load(projectPath) {
    let graph;
    try {
        graph = graphifyService.readGraph(projectPath);
    } catch (err) {
        logger.warn('graph_facts_unavailable', { path: projectPath, reason: err.message });
        return null;
    }

    const nodes = graph.nodes || [];
    const links = graph.links || graph.edges || [];
    if (nodes.length === 0) return null;

    const fileById = new Map(nodes.map(node => [node.id, nodeSourceFile(node)]));
    const files = new Set([...fileById.values()].filter(Boolean));

    const dependsOn = new Map();      // file -> Set(files it imports)
    const dependedOnBy = new Map();   // file -> Set(files importing it)
    const degree = new Map();

    const add = (map, key, value) => {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(value);
    };

    for (const link of links) {
        const relation = String(link.relation || '').toLowerCase();
        if (!DEPENDENCY_RELATIONS.has(relation)) continue;

        const from = fileById.get(link.source);
        const to = fileById.get(link.target);
        if (!from || !to || from === to) continue;

        add(dependsOn, from, to);
        add(dependedOnBy, to, from);
        degree.set(from, (degree.get(from) || 0) + 1);
        degree.set(to, (degree.get(to) || 0) + 1);
    }

    return { files, degree, dependsOn, dependedOnBy, nodeCount: nodes.length, linkCount: links.length };
}

/**
 * Files that nothing imports — dead code candidates.
 *
 * Uses resolved graph edges rather than text matching, so it is not fooled by
 * two files sharing a basename, by aliased or dynamic imports, or by a name
 * appearing inside an unrelated string.
 */
function orphanFiles(projectPath, { includeTests = false, extensions = null, facts = null } = {}) {
    const graph = facts || load(projectPath);
    if (!graph) return null;

    // Docs and data files are legitimately imported by nothing; without this
    // filter every README shows up as dead code.
    const allowed = extensions
        ? new Set(extensions.map(ext => (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase()))
        : null;

    const orphans = [];
    for (const file of graph.files) {
        if (allowed && !allowed.has(path.extname(file).toLowerCase())) continue;
        if (graph.dependedOnBy.has(file)) continue;   // something imports it
        if (isEntryPoint(file)) continue;             // legitimately unimported
        if (!includeTests && isTestFile(file)) continue; // test runners load these
        orphans.push({
            file,
            imports: graph.dependsOn.get(file)?.size || 0,
            isTest: isTestFile(file)
        });
    }

    // Files that import a lot but are imported by nothing are the most
    // suspicious — they represent real abandoned work, not stubs.
    return orphans.sort((a, b) => b.imports - a.imports || a.file.localeCompare(b.file));
}

/**
 * Which test files exercise each source file.
 *
 * Walks forward from each test file rather than backward from every source
 * file: there are far fewer tests than sources, so this is one BFS per test
 * instead of one per file.
 */
function coverageByFile(projectPath, { depth = 2, facts = null } = {}) {
    const graph = facts || load(projectPath);
    if (!graph) return null;

    const coverage = new Map();
    const tests = [...graph.files].filter(isTestFile);

    for (const test of tests) {
        const seen = new Set([test]);
        let frontier = [test];

        for (let hop = 0; hop < depth && frontier.length; hop += 1) {
            const next = [];
            for (const file of frontier) {
                for (const target of graph.dependsOn.get(file) || []) {
                    if (seen.has(target)) continue;
                    seen.add(target);
                    next.push(target);
                    if (isTestFile(target)) continue;
                    if (!coverage.has(target)) coverage.set(target, []);
                    coverage.get(target).push(test);
                }
            }
            frontier = next;
        }
    }

    return coverage;
}

/** Busiest files in the graph, most connected first. */
function centralFiles(projectPath, { limit = 25, facts = null } = {}) {
    const graph = facts || load(projectPath);
    if (!graph) return null;

    return [...graph.degree.entries()]
        .map(([file, connections]) => ({
            file,
            connections,
            dependents: graph.dependedOnBy.get(file)?.size || 0
        }))
        .sort((a, b) => b.connections - a.connections || a.file.localeCompare(b.file))
        .slice(0, limit);
}

// LOAD-BEARING: `orphanFiles` and `coverageByFile` have NO caller in backend/ or
// src/. Their only consumers are shipped plugins — plugins/Droid-Sweep.js and
// plugins/lightsaber.js respectively — which are themselves loaded by a computed
// require() (see ToolBox.loadPlugins). Static analysis therefore reports both as
// unused exports. They are the public surface this module exists to provide.
// See docs/dead-code.md.
module.exports = {
    load,
    orphanFiles,
    coverageByFile,
    centralFiles,
    isEntryPoint,
    toRelative,
    ENTRY_PATTERNS
};
