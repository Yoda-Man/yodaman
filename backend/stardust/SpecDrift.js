/**
 * SpecDrift — compares intended architecture against actual architecture.
 *
 * OpenSpec holds the system you said you would build. Graphify holds the one you
 * did build. Nothing compared them, and that comparison is the single thing
 * three mandatory dependencies buy that no individual tool can:
 *
 *   - a graph-only tool has no notion of intent
 *   - a spec-only tool has no notion of reality
 *
 * Deliberately does NOT invent a machine-readable architecture DSL for specs to
 * declare. OpenSpec specs are prose, so drift is derived from what the prose
 * actually references:
 *
 *   staleReferences — a spec cites a file the graph has never seen. The file was
 *                     renamed or deleted and the spec was not updated, so the
 *                     spec is now lying about the codebase.
 *   undocumented    — a heavily depended-on module no spec mentions at all.
 *                     Architecturally load-bearing, with no recorded intent.
 *
 * Exports:
 *   findOpenSpecRoot(projectRoot)   → absolute path or null
 *   readSpecs(projectRoot)          → [{ id, file, text }]
 *   extractReferences(text)         → repo-relative paths cited in prose
 *   detectDrift(projectRoot, opts)  → drift report
 */

const fs = require('fs');
const path = require('path');
const graphFacts = require('../infrastructure/GraphFacts');
const logger = require('../infrastructure/Logger');

// Only count references that look like real source paths. A bare word could be
// anything; a path with a directory separator or a known code extension is a
// deliberate citation.
const REFERENCE_PATTERN =
    /(?:^|[\s`'"([])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,5}|[A-Za-z0-9_.-]+\.(?:js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|rb|php|swift|kt))(?=$|[\s`'".,;:)\]])/g;

// Paths that are cited constantly but are not application architecture.
const IGNORED_REFERENCES = [
    /^package(-lock)?\.json$/i,
    /^(README|CHANGELOG|LICENSE)\.md$/i,
    /^node_modules\//,
    /\.(md|txt|yaml|yml|lock)$/i
];

function isIgnoredReference(reference) {
    return IGNORED_REFERENCES.some(pattern => pattern.test(reference));
}

/** Locate the OpenSpec root, honouring the CLI's own layout. */
function findOpenSpecRoot(projectRoot) {
    const candidate = path.join(projectRoot, 'openspec');
    try {
        if (fs.existsSync(path.join(candidate, 'config.yaml')) || fs.existsSync(path.join(candidate, 'specs'))) {
            return candidate;
        }
    } catch (_) { /* unreadable — treat as absent */ }
    return null;
}

/** Read every spec markdown file under the OpenSpec root. */
function readSpecs(projectRoot) {
    const root = findOpenSpecRoot(projectRoot);
    if (!root) return [];

    const specsDir = path.join(root, 'specs');
    if (!fs.existsSync(specsDir)) return [];

    const specs = [];
    const walk = (dir, depth = 0) => {
        if (depth > 6) return;
        let entries;
        // Skip an unreadable directory rather than abandoning the scan: a partial
        // set of specs still detects real drift.
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full, depth + 1);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
                try {
                    specs.push({
                        id: path.relative(specsDir, full).split(path.sep).join('/'),
                        file: full,
                        text: fs.readFileSync(full, 'utf8')
                    });
                } catch (_) { /* skip unreadable spec */ }
            }
        }
    };
    walk(specsDir);
    return specs;
}

/** Pull the source-file paths a spec's prose cites. */
function extractReferences(text) {
    const found = new Set();
    REFERENCE_PATTERN.lastIndex = 0;
    let match;
    while ((match = REFERENCE_PATTERN.exec(String(text || ''))) !== null) {
        const reference = match[1].replace(/^\.\//, '');
        if (!isIgnoredReference(reference)) found.add(reference);
    }
    return [...found];
}

/**
 * Compare specs against the graph.
 *
 * Returns `{ available: false, reason }` rather than throwing when either side
 * is missing — drift is an insight, never a blocker.
 *
 * `specs` mirrors the existing `facts` escape hatch: a caller that has already
 * read the specs can hand them in instead of paying for a second walk of
 * openspec/. StardustBrief needs the spec list anyway to say which specs describe
 * the files in hand, so without this every task read the same directory twice.
 */
function detectDrift(projectRoot, { minDependents = 2, facts = null, specs: preRead = null } = {}) {
    const specs = preRead || readSpecs(projectRoot);

    // A workspace with no specs used to return available:false, which meant the
    // single most distinctive signal YodaMan has was invisible to every new
    // user — precisely the people who have not written specs yet.
    //
    // But "no specs" is not "cannot tell". It is the strongest possible answer
    // to the coverage question: nothing here is documented. The undocumented
    // half of this report needs only the graph, because it ranks load-bearing
    // modules and subtracts the ones specs cite — and with no specs, that
    // subtraction removes nothing. So compute it, and say plainly what it means.
    //
    // Only a missing graph is genuinely unanswerable.
    const graph = facts || graphFacts.load(projectRoot);
    if (!graph) {
        return { available: false, reason: 'no knowledge graph has been built for this workspace yet' };
    }

    // Index graph files by both full path and basename: specs often cite a file
    // by name alone, and treating that as stale would be a false alarm.
    const graphFilesByName = new Map();
    for (const file of graph.files) {
        const base = path.basename(file);
        if (!graphFilesByName.has(base)) graphFilesByName.set(base, []);
        graphFilesByName.get(base).push(file);
    }

    const staleReferences = [];
    const citedFiles = new Set();

    for (const spec of specs) {
        for (const reference of extractReferences(spec.text)) {
            if (graph.files.has(reference)) {
                citedFiles.add(reference);
                continue;
            }
            const byBase = graphFilesByName.get(path.basename(reference));
            if (byBase && byBase.length > 0) {
                // Cited by name and the name exists — good enough to count as
                // documented, and not evidence of drift.
                byBase.forEach(file => citedFiles.add(file));
                continue;
            }
            staleReferences.push({ spec: spec.id, reference });
        }
    }

    // Load-bearing modules with no recorded intent anywhere in the specs.
    const undocumented = [...graph.files]
        .map(file => ({ file, dependents: graph.dependedOnBy.get(file)?.size || 0 }))
        .filter(entry => entry.dependents >= minDependents && !citedFiles.has(entry.file))
        .sort((a, b) => b.dependents - a.dependents);

    const report = {
        available: true,
        // Distinguishes "measured against specs" from "measured against
        // nothing, because there are none" — the same numbers mean different
        // things, and a caller that cannot tell them apart will mislead.
        covered: specs.length > 0,
        openSpecInitialized: Boolean(findOpenSpecRoot(projectRoot)),
        specCount: specs.length,
        graphFileCount: graph.files.size,
        documentedFiles: citedFiles.size,
        staleReferences,
        staleCount: staleReferences.length,
        undocumented: undocumented.slice(0, 20),
        undocumentedCount: undocumented.length,
        // With no specs, "in sync" would be true only for a workspace whose
        // graph has no load-bearing modules at all. Saying specs and code agree
        // when there are no specs is a lie of omission.
        inSync: specs.length > 0 && staleReferences.length === 0 && undocumented.length === 0
    };

    logger.info('spec_drift_checked', {
        path: projectRoot,
        specs: report.specCount,
        stale: report.staleCount,
        undocumented: report.undocumentedCount,
        inSync: report.inSync
    });

    return report;
}

/** Human-readable lines, in the style of the graph doctor. */
function formatDrift(report) {
    if (!report?.available) {
        return `Architecture drift unavailable — ${report?.reason || 'unknown reason'}`;
    }
    if (report.inSync) {
        return `✓ Specs and code agree across ${report.specCount} spec${report.specCount === 1 ? '' : 's'}`;
    }

    const lines = [];

    // Lead with the finding, not with the setup step. A new user learns what
    // their codebase looks like first, and how to act on it second.
    if (!report.covered) {
        lines.push(
            `${report.undocumentedCount} load-bearing module${report.undocumentedCount === 1 ? '' : 's'} `
            + `in this workspace, and nothing describes ${report.undocumentedCount === 1 ? 'it' : 'them'}.`
        );
        if (report.undocumentedCount > 0) {
            lines.push(report.openSpecInitialized
                ? 'Write a spec for the modules below to start tracking intent against code.'
                : 'Run `openspec init .` to start tracking intent against code.');
        }
    }
    for (const stale of report.staleReferences.slice(0, 10)) {
        lines.push(`⚠️ Spec "${stale.spec}" references ${stale.reference}, which is not in the graph — renamed or deleted`);
    }
    for (const entry of report.undocumented.slice(0, 10)) {
        lines.push(`💡 ${entry.file} is depended on by ${entry.dependents} file${entry.dependents === 1 ? '' : 's'} but no spec describes it`);
    }
    if (report.staleCount > 10 || report.undocumentedCount > 10) {
        lines.push(`… ${report.staleCount} stale reference(s) and ${report.undocumentedCount} undocumented module(s) in total`);
    }
    return lines.join('\n');
}

module.exports = { findOpenSpecRoot, readSpecs, extractReferences, detectDrift, formatDrift };
