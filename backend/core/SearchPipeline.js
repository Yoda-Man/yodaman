/**
 * THE search pipeline. Every search in YodaMan goes through `search()`.
 *
 * The three pillars, in order, and nothing else:
 *
 *   1. Context Expert RETRIEVES   semantic hits for code and/or docs
 *   2. Graphify RANKS             semantic 0.50 + proximity 0.20 + centrality 0.15
 *                                 + spec coverage 0.15 (GraphRanker)
 *   3. OpenSpec TAGS              each hit with the specs that cover it
 *
 * plus one hygiene step between retrieval and ranking: remove duplicates, drop
 * YodaMan's own generated files, and drop hits whose file is no longer on disk.
 *
 * WHY ONE MODULE:
 *
 * The stages used to be assembled by hand wherever a search was needed, and
 * each copy assembled a different subset. Measured on 2026-10-08:
 *
 *   Search view            Context Expert + Graphify + OpenSpec
 *   agent searchCode tool  Context Expert only
 *   SearchTrace            Context Expert + Graphify
 *   docs search            Context Expert only
 *   ask fallback           Context Expert only
 *   Chat search shortcut   Context Expert only (its first version)
 *
 * The same query ranked differently depending on where it was typed, and
 * nothing said so. The blend is the product; a path that skips it is a
 * different, weaker product wearing the same name.
 *
 * Callers choose WHAT to retrieve (`mode`: unified, code, doc). They cannot
 * choose to skip a stage, and a search never writes into the workspace. The raw Context Expert call (ToolBox.contextExpertSearch)
 * is private to this module, enforced by tests/architecture/SearchPipelineBoundary.test.js.
 *
 * Every result reports which pillars actually contributed (`pillars`), so a
 * search that degraded, for example because no graph exists yet, can never
 * look like one that did not.
 */
const fs = require('fs');
const path = require('path');

const toolBox = require('../infrastructure/ToolBox');
const logger = require('../infrastructure/Logger');
const graphRanker = require('../infrastructure/GraphRanker');
const specDrift = require('../stardust/SpecDrift');
const { hitPath, dedupeHits } = require('../../shared/searchHits');

const CONFIG_PATH = path.join(__dirname, '../../config.json');
const MODES = new Set(['unified', 'code', 'doc']);
const MISSING_WORKSPACE_HINT = 'It may have been moved or deleted: edit its path in Settings, or remove it there.';

// YodaMan's own output. ctx indexes whatever is in the workspace, including
// graphify-out/ (Graphify's hash-named AST cache): a search for
// "Architecture_Overview_Document" once returned five copies of
// graphify-out/cache/ast/86c41b74….json instead of the document. They are
// never in the knowledge graph, so they also silently disabled graph ranking.
const GENERATED = /(^|\/)(graphify-out|\.yodaman|\.yodaman-doc-chunks|node_modules|dist|release)\//;

function loadWatchedDirectories() {
    if (!fs.existsSync(CONFIG_PATH)) return [];
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return Array.isArray(config.watchedDirectories) ? config.watchedDirectories : [];
    } catch (err) {
        logger.error('search_config_load_failed', err, { path: CONFIG_PATH, userAction: 'code_search', severity: 'medium' });
        return [];
    }
}

/** A workspace name ("Anchor") or path, as an absolute path when registered. */
function resolveProject(project) {
    if (!project) return undefined;
    if (path.isAbsolute(project)) return project;
    const match = loadWatchedDirectories().find((dir) => dir === project || path.basename(dir) === project);
    return match || project;
}

function normalizeTop(top) {
    const value = Number(top || 10);
    if (!Number.isFinite(value) || value <= 0) return 10;
    return Math.min(Math.floor(value), 50);
}


// ── Stage 1: Context Expert retrieves ───────────────────────────────────────

// What counts as documentation for 'doc' mode, and for tagging a hit's source.
const DOC_FILE = /\.(md|markdown|rst|txt|adoc)$/i;

/**
 * One Context Expert query per search, for every mode.
 *
 * 'unified' used to run two: a code search, and a "docs search" that first
 * ran a preprocessor writing chunk files into the workspace and rewriting a
 * config.json inside it. Those chunks live in `.yodaman-doc-chunks`, which is
 * on the index-ignore list, so they were never indexed: the docs search was
 * the code search again. Every hit came back twice, and each search left
 * thousands of untracked files in the user's repository (6,903 in one).
 * Context Expert indexes documentation itself, so docs are a filter on the
 * same results.
 */
async function retrieve({ mode, query, project, top }) {
    const hits = (await toolBox.contextExpertSearch({ query, project, top })) || [];
    const tagged = (Array.isArray(hits) ? hits : [])
        .map((hit) => ({ ...hit, _source: DOC_FILE.test(hitPath(hit)) ? 'docs' : 'code' }));
    return mode === 'doc' ? tagged.filter((hit) => hit._source === 'docs') : tagged;
}

/**
 * Did Context Expert actually answer, or did retrieval fall back to a literal
 * filesystem scan (ctx unavailable, or the workspace not indexed)? Reporting
 * the fallback as Context Expert would hide exactly the degradation the
 * `pillars` field exists to show.
 */
function answeredByContextExpert(hits) {
    return hits.length === 0 || hits.some((hit) => hit?.metadata?.source !== 'filesystem-fallback');
}

// ── Hygiene: only real, user-owned files go on to be ranked ────────────────

/**
 * Drop generated output, and drop hits whose file is gone.
 *
 * The second matters more than it looks. When a workspace folder is moved or
 * deleted, Context Expert keeps its index, so searches keep returning files
 * that do not exist. The agent then spends its whole step budget failing to
 * read them ("File not found", ten times, then "maximum number of steps"), and
 * the user cannot open any result. Measured on a workspace whose folder had
 * moved: every hit pointed at a missing file.
 */
function keepRealFiles(hits, project) {
    const kept = [];
    let generated = 0;
    let missing = 0;
    // Unified mode asks Context Expert twice (code, then docs) and both return
    // the same chunks, so every hit used to appear twice in the Search view.
    // Deduplicated once, here, so no consumer needs its own copy.
    const unique = dedupeHits(hits);
    for (const hit of unique) {
        const rel = hitPath(hit);
        if (GENERATED.test(rel)) { generated += 1; continue; }
        if (project && rel) {
            const absolute = path.isAbsolute(rel) ? rel : path.join(project, rel);
            if (!fs.existsSync(absolute)) { missing += 1; continue; }
        }
        kept.push(hit);
    }
    return { kept, generated, missing, duplicates: hits.length - unique.length };
}

// ── Stage 2: Graphify ranks ─────────────────────────────────────────────────

/** Advisory: a graph problem returns the input order, never a failed search. */
function rank(hits, { project, activeFile, requestId, mode }) {
    if (!project || hits.length < 2) return hits;
    try {
        return graphRanker.rerank(project, hits, { activeFile });
    } catch (err) {
        logger.warn('search_graph_rerank_skipped', { requestId, project, mode, reason: err.message });
        return hits;
    }
}

/** rerank() returns the input untouched when the graph knows none of the hits. */
function wasGraphRanked(hits) {
    return Array.isArray(hits) && hits.some((hit) => hit && hit.graphSignal);
}

// ── Stage 3: OpenSpec tags ──────────────────────────────────────────────────

/** @returns {{hits: object[], specsFound: boolean}} */
function tag(hits, project) {
    try {
        const specs = project ? specDrift.readSpecs(project) : [];
        if (!specs || specs.length === 0) return { hits, specsFound: false };
        const mentions = new Map();
        for (const spec of specs) {
            for (const ref of specDrift.extractReferences(spec.text)) {
                mentions.set(ref, (mentions.get(ref) || new Set()).add(spec.id));
            }
        }
        return {
            specsFound: true,
            hits: hits.map((hit) => {
                const file = hitPath(hit);
                const found = mentions.get(file) || mentions.get(file.split('/').pop());
                return { ...hit, specFlag: found ? { covered: true, specs: [...found].slice(0, 3) } : { covered: false } };
            })
        };
    } catch (_err) {
        // Advisory: a workspace without OpenSpec still gets its results.
        return { hits, specsFound: false };
    }
}

// ── The pipeline ────────────────────────────────────────────────────────────

/**
 * Search a workspace through all three pillars.
 *
 * @param {object} input
 * @param {string} input.query
 * @param {string} [input.project]     Workspace path or registered name.
 * @param {'unified'|'code'|'doc'} [input.mode] What to retrieve. Ranking and
 *                                     tagging are the same for every mode.
 * @param {number} [input.top]
 * @param {string} [input.activeFile]  Lets proximity contribute to ranking.
 * @param {string} [input.requestId]
 * @returns {Promise<{results: object[], graphRanked: boolean, weights: object,
 *   activeFile: string|null, pillars: {contextExpert: boolean, graphify: boolean, openspec: boolean},
 *   dropped: {generated: number, missing: number}}>}
 */
async function search({ query, project, mode = 'unified', top = 15, activeFile, requestId } = {}) {
    if (!MODES.has(mode)) throw new Error(`Unknown search mode: ${mode}`);
    const workspace = resolveProject(project);
    const limit = normalizeTop(top);
    if (workspace && path.isAbsolute(workspace) && !fs.existsSync(workspace)) {
        // Its index outlives it, so searching would return only files that
        // cannot be opened. Say what is actually wrong instead.
        const err = new Error(`Workspace folder not found: ${workspace}. ${MISSING_WORKSPACE_HINT}`);
        err.status = 404;
        err.code = 'workspace_missing';
        throw err;
    }

    const retrieved = await retrieve({ mode, query, project: workspace, top: limit });
    const { kept, generated, missing, duplicates } = keepRealFiles(retrieved, workspace);
    if (generated || missing) {
        logger.info('search_hits_dropped', { requestId, project: workspace, generated, missing, kept: kept.length });
    }

    const ranked = rank(kept, { project: workspace, activeFile, requestId, mode });
    const graphRanked = wasGraphRanked(ranked);
    const { hits, specsFound } = tag(ranked, workspace);

    // When a graph exists but recognises none of the hits, ranking falls back to
    // semantic-only while still advertising the blend. Usually ctx and Graphify
    // were indexed from different roots. Say so once per search.
    if (!graphRanked && workspace && kept.length >= 2) {
        logger.warn('search_graph_ranking_inactive', {
            requestId,
            project: workspace,
            hits: kept.length,
            hint: 'Graphify ranked none of these hits. Either no graph has been built for this workspace, '
                + 'or ctx and Graphify were indexed from different roots. Ranking fell back to semantic relevance.'
        });
    }

    return {
        results: hits,
        graphRanked,
        weights: graphRanker.DEFAULT_WEIGHTS,
        activeFile: activeFile || null,
        pillars: { contextExpert: answeredByContextExpert(retrieved), graphify: graphRanked, openspec: specsFound },
        dropped: { generated, missing, duplicates }
    };
}

module.exports = { search, resolveProject, MODES };
