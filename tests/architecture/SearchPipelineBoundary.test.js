/**
 * No search in YodaMan may bypass the three-pillar pipeline.
 *
 * Context Expert retrieval, Graphify ranking and OpenSpec tagging are the core
 * of the product, and SearchPipeline.search is the only place they are put
 * together. This test fails the build if code anywhere else:
 *
 *   - calls raw Context Expert retrieval (ToolBox.contextExpertSearch),
 *   - spawns `ctx search` itself,
 *   - re-ranks with Graphify by hand (GraphRanker.rerank), or
 *   - sets OpenSpec coverage tags by hand (specFlag).
 *
 * Each of those is how a partial search got built before: on 2026-10-08 six
 * entry points searched, and they combined five different subsets of the
 * pillars. A rule that only lives in a comment does not survive the next
 * shortcut; this one runs on every `npm test`.
 *
 * If you need a new kind of search, add a mode to SearchPipeline, not a new
 * assembly of its parts.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCANNED = ['backend', 'bin', 'shared', 'electron', 'src', 'server.js', 'start.js'];
const PIPELINE = 'backend/core/SearchPipeline.js';

function files(rel) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return [];
    if (fs.statSync(full).isFile()) return [rel];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
        const child = path.join(rel, entry.name);
        if (entry.isDirectory()) return files(child);
        return /\.(c?js|mjs|jsx)$/.test(entry.name) ? [child] : [];
    });
}

/** Source with comments removed, so explaining the rule is not breaking it. */
function code(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const ALL = SCANNED.flatMap(files);

/** Files (other than those allowed) whose code matches the pattern. */
function offenders(pattern, allowed) {
    return ALL.filter((rel) => !allowed.includes(rel) && pattern.test(code(rel)));
}

describe('the search pipeline boundary', () => {
    test('the scan covers the codebase and finds the pipeline itself', () => {
        // Guards against every rule below passing because nothing was scanned.
        expect(ALL.length).toBeGreaterThan(50);
        expect(ALL).toContain(PIPELINE);
        expect(code(PIPELINE)).toMatch(/contextExpertSearch\(/);
        expect(code(PIPELINE)).toMatch(/\.rerank\(/);
        expect(code(PIPELINE)).toMatch(/specFlag:/);
    });

    test('raw Context Expert retrieval is called only by the pipeline', () => {
        expect(offenders(/\bcontextExpertSearch\s*\(/, [PIPELINE, 'backend/infrastructure/ToolBox.js'])).toEqual([]);
    });

    test('`ctx search` is spawned only inside ToolBox.contextExpertSearch', () => {
        // An argument list starting 'search' followed by a variable: a spawn,
        // not a word in a table of labels.
        const spawn = /\[\s*['"]search['"]\s*,\s*[A-Za-z_$]/;
        expect(offenders(spawn, ['backend/infrastructure/ToolBox.js'])).toEqual([]);

        const toolBox = code('backend/infrastructure/ToolBox.js');
        const start = toolBox.indexOf('async contextExpertSearch(');
        const end = toolBox.indexOf('normalizeSearchHits(hits) {', start);
        expect(start).toBeGreaterThan(-1);
        expect(spawn.test(toolBox.slice(start, end))).toBe(true);
        expect(spawn.test(toolBox.slice(0, start) + toolBox.slice(end))).toBe(false);
    });

    test('Graphify ranking is applied only by the pipeline', () => {
        expect(offenders(/\.rerank\s*\(/, [PIPELINE, 'backend/infrastructure/GraphRanker.js'])).toEqual([]);
    });

    test('OpenSpec coverage tags are set only by the pipeline', () => {
        expect(offenders(/\bspecFlag\s*:/, [PIPELINE])).toEqual([]);
    });

    test('the agent\'s search tool is the pipeline, not Context Expert alone', () => {
        const toolBox = code('backend/infrastructure/ToolBox.js');
        const body = toolBox.slice(toolBox.indexOf('async searchCode('), toolBox.indexOf('async contextExpertSearch('));
        expect(body).toMatch(/require\('\.\.\/core\/SearchPipeline'\)/);
        expect(body).not.toMatch(/contextExpertSearch|executeJson/);
    });

    test('every HTTP search endpoint goes through the pipeline', () => {
        const router = code('backend/services/searchRouter.js');
        expect(router).toMatch(/require\('\.\.\/core\/SearchPipeline'\)/);
        expect(router).not.toMatch(/require\('\.\.\/infrastructure\/(ToolBox|GraphRanker)'\)|SpecDrift/);
    });
});
