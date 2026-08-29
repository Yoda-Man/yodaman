/**
 * StardustBrief — what the workspace already knows, handed to the model up front.
 *
 * The three mandatory tools each hold something the model needs before it writes
 * its first line, and none of it was reaching the prompt:
 *
 *   Graphify was reaching it, but blindly — a fixed 4,000-character slice of
 *   GRAPH_REPORT.md prepended to every task, whether the task was structural or
 *   a typo fix. Prose about the whole repository, not about the files in hand.
 *
 *   OpenSpec was not reaching it at all. Specs were consulted only at the
 *   writeFile approval gate, which is *after* the model has decided what to
 *   write. It planned without knowing what the specs promise.
 *
 *   Drift was computed for the Drift tab and never shown to the model, so it
 *   would happily add a second undocumented implementation of something a spec
 *   already describes.
 *
 * This composes all three into one block, scoped to the files the task actually
 * names. The expensive part — resolving the graph — happens once and is shared
 * across every section, which is why this is worth doing here rather than in
 * three separate places.
 *
 * Nothing here is load-bearing: every section degrades to a line of explanation
 * when its tool is unavailable, because a missing graph must never fail a task.
 */

const path = require('path');
const graphFacts = require('../infrastructure/GraphFacts');
const impactAnalyzer = require('../infrastructure/ImpactAnalyzer');
const graphifyService = require('../infrastructure/GraphifyService');
const specDrift = require('../stardust/SpecDrift');
const logger = require('../infrastructure/Logger');

// Paths and module names look like these. Deliberately loose — a false positive
// costs one cheap graph lookup, a false negative costs the model its context.
const PATH_PATTERN = /\b[\w.-]+(?:[/\\][\w.-]+)+\.[a-z]{1,5}\b/gi;
const BARE_FILE_PATTERN = /\b[\w-]+\.(?:js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|php|cs|md|json|ya?ml)\b/gi;

const MAX_FOCUS_FILES = 6;
const MAX_CENTRAL_FILES = 5;
const MAX_REPORT_CHARS = 1600;

/**
 * Sections of GRAPH_REPORT.md worth a prompt's tokens.
 *
 * The report is ~1,600 lines, and the first 300 of them are an Obsidian
 * navigation index — `[[_COMMUNITY_Community 14|Community 14]]` repeated once per
 * community. Taking a head slice, as the old context did, spent almost the whole
 * budget on those links. The two sections below are the ones that actually tell
 * the model something: the core abstractions, and coupling nobody expected.
 */
const USEFUL_REPORT_SECTIONS = [
    'God Nodes',
    'Surprising Connections',
];

/**
 * File-ish tokens in the task text, resolved against the graph.
 *
 * Matching by basename as well as by full path matters: people write "fix
 * ToolBox.js", not "fix backend/infrastructure/ToolBox.js". An unresolvable
 * token is dropped rather than reported, so the brief never invents a file.
 */
function focusFiles(task, graph) {
    const mentioned = new Set();
    for (const pattern of [PATH_PATTERN, BARE_FILE_PATTERN]) {
        pattern.lastIndex = 0;
        for (const match of String(task || '').matchAll(pattern)) {
            mentioned.add(match[0].split('\\').join('/'));
        }
    }
    if (mentioned.size === 0 || !graph) return [];

    const byBasename = new Map();
    for (const file of graph.files) {
        const base = path.basename(file);
        if (!byBasename.has(base)) byBasename.set(base, []);
        byBasename.get(base).push(file);
    }

    const resolved = new Set();
    for (const token of mentioned) {
        if (graph.files.has(token)) {
            resolved.add(token);
            continue;
        }
        // Cited by name, or by a path suffix ("infrastructure/ToolBox.js").
        const candidates = byBasename.get(path.basename(token)) || [];
        const suffixMatch = candidates.find(file => file.endsWith(token)) || candidates[0];
        if (suffixMatch) resolved.add(suffixMatch);
    }

    return [...resolved].slice(0, MAX_FOCUS_FILES);
}

/**
 * Pull the named sections out of GRAPH_REPORT.md, in report order.
 *
 * Falls back to a head slice when none of the expected headings are present, so a
 * change to graphify's report format degrades to the old behaviour rather than
 * dropping the section entirely.
 */
function usefulReportSections(report, maxChars = MAX_REPORT_CHARS) {
    const text = String(report || '');
    if (!text.trim()) return '';

    const lines = text.split('\n');
    const kept = [];
    let capturing = false;

    for (const line of lines) {
        const heading = line.match(/^##\s+(.*)$/);
        if (heading) {
            capturing = USEFUL_REPORT_SECTIONS.some(name => heading[1].startsWith(name));
        }
        if (capturing) kept.push(line);
        if (kept.join('\n').length > maxChars) break;
    }

    if (kept.length === 0) return text.slice(0, maxChars).trim();
    return kept.join('\n').slice(0, maxChars).trim();
}

/** Which spec ids reference a file. Cheap once the specs are already read. */
function specsDescribing(specs, file) {
    const found = [];
    for (const spec of specs) {
        const references = specDrift.extractReferences(spec.text);
        if (references.some(reference => file.endsWith(reference) || reference.endsWith(path.basename(file)))) {
            found.push(spec.id);
        }
    }
    return found;
}

/**
 * Build the brief. Always returns a string — empty when there is no workspace.
 *
 * @param {string} projectRoot
 * @param {string} task
 * @returns {Promise<{text: string, available: boolean, focusCount: number}>}
 */
async function build(projectRoot, task) {
    if (!projectRoot) return { text: '', available: false, focusCount: 0 };

    const sections = [];
    let graph = null;
    let focus = [];

    // ── Graphify: the shape of the workspace, and the files in hand ──
    try {
        graph = graphFacts.load(projectRoot);
    } catch (err) {
        logger.warn('brief_graph_unavailable', { path: projectRoot, reason: err.message });
    }

    if (!graph) {
        sections.push('Graphify: no knowledge graph for this workspace yet. Structural claims cannot be verified — say so rather than guessing at dependencies.');
    } else {
        let stale = false;
        try {
            stale = Boolean(graphifyService.freshness(projectRoot, { scanSources: false }).stale);
        } catch (_) { /* freshness is advisory */ }

        const central = graphFacts.centralFiles(projectRoot, { limit: MAX_CENTRAL_FILES, facts: graph }) || [];
        sections.push([
            `Graphify: ${graph.files.size} files, ${graph.linkCount} dependency edges${stale ? ' — GRAPH IS STALE, it may predate recent edits' : ''}.`,
            central.length > 0
                ? `Busiest modules (changing these reaches the most code): ${central.map(entry => `${entry.file} (${entry.dependents} dependents)`).join(', ')}.`
                : '',
        ].filter(Boolean).join('\n'));

        focus = focusFiles(task, graph);
    }

    // ── OpenSpec: recorded intent, and where it has drifted from the code ──
    let specs = [];
    try {
        specs = specDrift.readSpecs(projectRoot);
    } catch (_) { /* treated as no specs */ }

    // Drift runs whether or not specs exist. A workspace with none is not a
    // workspace we know nothing about — it is one where NOTHING is documented,
    // which is the strongest coverage answer there is. Telling a new user only
    // "no specs written" withholds the finding and leaves them a chore.
    //
    // Hand over the specs already read above rather than making detectDrift
    // walk openspec/ a second time for the same answer.
    const drift = specDrift.detectDrift(projectRoot, { facts: graph, specs });

    // Undocumented hubs are where a second implementation gets added by
    // accident — someone adds a capability the hub already provides, because
    // nothing described it. That is the part of drift worth naming explicitly,
    // and it is available with zero specs.
    const hubs = drift?.undocumented?.length > 0
        ? `Undocumented hubs — check these before adding anything they might already do: `
          + `${drift.undocumented.slice(0, 5).map(entry => `${entry.file} (${entry.dependents} dependents)`).join(', ')}.`
        : '';

    if (specs.length === 0) {
        sections.push([
            'OpenSpec: no specs written for this workspace. Nothing constrains this change, and nothing records the intent behind existing code.',
            drift?.available
                ? `Coverage: ${drift.undocumentedCount} load-bearing module(s) carry this codebase and none of them are described.`
                : '',
            hubs
        ].filter(Boolean).join('\n'));
    } else {
        sections.push([
            `OpenSpec: ${specs.length} spec${specs.length === 1 ? '' : 's'} (${specs.map(spec => spec.id).slice(0, 8).join(', ')}).`,
            drift?.available
                ? `Drift: ${drift.staleCount} stale reference(s), ${drift.undocumentedCount} load-bearing module(s) no spec describes.`
                : '',
            hubs
        ].filter(Boolean).join('\n'));
    }

    // ── The files this task names, with their blast radius up front ──
    if (focus.length > 0) {
        const lines = [`Files this task names, already analyzed (do not re-derive this):`];
        for (const file of focus) {
            const impact = impactAnalyzer.analyzeFile(projectRoot, file, { depth: 2 });
            if (!impact?.available) {
                lines.push(`- ${file}: not in the graph (${impact?.reason || 'unknown'})`);
                continue;
            }
            const describedBy = specsDescribing(specs, file);
            lines.push([
                `- ${file}: ${impact.risk} risk`,
                `${impact.impactedCount} dependent${impact.impactedCount === 1 ? '' : 's'} within 2 hops`,
                impact.testCount > 0
                    ? `${impact.testCount} covering test${impact.testCount === 1 ? '' : 's'} (${impact.coveringTests.slice(0, 2).join(', ')})`
                    : 'NO covering tests',
                describedBy.length > 0 ? `described by ${describedBy.join(', ')}` : 'no spec describes it',
            ].join(' · '));
        }
        sections.push(lines.join('\n'));
    }

    // ── Graphify's own findings, as background ──
    // Read generously, then keep only the sections that say something. This used
    // to be a blind 4,000-character head slice, which on a real report is mostly
    // the Obsidian navigation index.
    try {
        const report = graphifyService.readReport(projectRoot, { maxChars: 60_000 });
        const useful = usefulReportSections(report);
        if (useful) {
            sections.push(`Graph findings (background, from GRAPH_REPORT.md):\n${useful}`);
        }
    } catch (_) { /* report is optional */ }

    const text = [
        '',
        '',
        '=== STARDUST BRIEF — this workspace, as the three tools see it ===',
        ...sections,
        '',
        'Use these facts directly; they are current as of the start of this task.',
        'Call impactOf(file, project) before editing any file this brief does not already cover.',
        'When you cite structure from the graph, append a "[view graph](http://localhost:5190)" link.',
        '=== END STARDUST BRIEF ===',
    ].join('\n');

    logger.info('stardust_brief_built', {
        path: projectRoot,
        graphAvailable: Boolean(graph),
        specCount: specs.length,
        focusCount: focus.length,
        chars: text.length,
    });

    return { text, available: Boolean(graph) || specs.length > 0, focusCount: focus.length };
}

module.exports = { build, focusFiles };
