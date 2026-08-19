// backend/services/searchRouter.js
/**
 * Search Router – Stardust-powered unified search across Context Expert,
 * Graphify, and OpenSpec. Every search returns results from all three tools
 * with provenance tagging and spec‑drift awareness.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const toolBox = require('../infrastructure/ToolBox');
const { preprocessDocumentation, updateCtxConfig } = require('../utils/docPreprocessor');
const logger = require('../infrastructure/Logger');
const graphRanker = require('../infrastructure/GraphRanker');
const specDrift = require('../stardust/SpecDrift');

const CONFIG_PATH = path.join(__dirname, '../../config.json');

function loadWatchedDirectories() {
  if (!fs.existsSync(CONFIG_PATH)) return [];
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return Array.isArray(config.watchedDirectories) ? config.watchedDirectories : [];
  } catch (err) {
    logger.error('search_config_load_failed', err, {
      path: CONFIG_PATH,
      userAction: 'code_search',
      severity: 'medium'
    });
    return [];
  }
}

function resolveProjectIdentifier(project) {
  if (!project) return undefined;
  if (path.isAbsolute(project)) return project;
  const match = loadWatchedDirectories().find((dir) => (
    dir === project ||
    path.basename(dir) === project
  ));
  return match || project;
}

function normalizeTop(top) {
  const value = Number(top || 10);
  if (!Number.isFinite(value) || value <= 0) return 10;
  return Math.min(Math.floor(value), 50);
}

/**
 * Blend Graphify structure into Context Expert's ranking.
 *
 * Reranking is advisory: any failure returns the original results untouched, so
 * a graph problem can never break search.
 */
function applyGraphRanking(results, { project, activeFile, req, mode }) {
  if (!project || !Array.isArray(results) || results.length < 2) return results;
  try {
    return graphRanker.rerank(project, results, { activeFile });
  } catch (err) {
    logger.warn('search_graph_rerank_skipped', {
      requestId: req?.id,
      project,
      mode,
      reason: err.message
    });
    return results;
  }
}

/**
 * Did structure actually contribute to this ordering?
 *
 * rerank() returns the input untouched when there is no graph, or when the graph
 * knows none of the hits. Callers that explain ranking need to tell those cases
 * apart from a real blend rather than presenting the weights as though they had
 * been applied.
 */
function wasGraphRanked(results) {
  return Array.isArray(results) && results.some(item => item && item.graphSignal);
}

function logSearchFailure(err, { req, query, project, mode }) {
  logger.error('search_failed', err, {
    requestId: req.id,
    query,
    project,
    mode,
    userAction: 'code_search',
    severity: 'high'
  });
}

// Helper for documentation search – ensures docs are pre‑processed.
async function docSearch({ query, project, top }) {
  if (project) {
    await preprocessDocumentation(project);
    await updateCtxConfig(project);
  }
  // Docs are indexed as regular files, reuse existing code search.
  return toolBox.searchCode({ query, project, top });
}

router.get('/', async (req, res) => {
  const { query, project, top = 15, activeFile } = req.query;
  if (!query) return res.status(400).send('Query is required');
  const resolvedProject = resolveProjectIdentifier(project);
  const normalizedTop = normalizeTop(top);
  try {
    // Run both code and doc searches in parallel — always cover everything.
    const [codeResults, docResults] = await Promise.all([
      toolBox.searchCode({ query, project: resolvedProject, top: normalizedTop }).catch(() => []),
      docSearch({ query, project: resolvedProject, top: normalizedTop }).catch(() => []),
    ]);

    // Merge with provenance tags
    const all = [
      ...(Array.isArray(codeResults) ? codeResults : []).map(r => ({ ...r, _source: 'code' })),
      ...(Array.isArray(docResults) ? docResults : []).map(r => ({ ...r, _source: 'docs' })),
    ];

    // Drop YodaMan's own generated output before ranking.
    //
    // ctx indexes whatever is in the workspace, and that includes graphify-out/
    // — Graphify's AST cache, written by us. Those files then dominate results:
    // a search for "Architecture_Overview_Document" returned five copies of
    // graphify-out/cache/ast/86c41b74….json instead of the document itself. They
    // are hash-named blobs of no use to a reader, they are never in the
    // knowledge graph, so nothing matched and graph ranking silently fell back
    // to semantic-only for the whole result set, and the agent was being handed
    // them as context.
    const generated = /(^|\/)(graphify-out|\.yodaman|node_modules|dist|release)\//;
    const source = all.filter((hit) => !generated.test(String(hit.filePath || hit.path || '')));
    const dropped = all.length - source.length;
    if (dropped > 0) {
      logger.info('search_generated_artifacts_filtered', {
        requestId: req.id,
        project: resolvedProject,
        dropped,
        kept: source.length
      });
    }

    // Rank the merged set through GraphRanker (now includes specCoverage)
    const results = applyGraphRanking(source, { project: resolvedProject, activeFile, req, mode: 'unified' });

    // Annotate with spec drift flags per hit
    const annotated = annotateSpecFlags(results, resolvedProject);

    // Silent degradation is the failure mode here. When a graph exists but
    // recognises none of the hits, ranking quietly falls back to semantic-only
    // while the API still advertises the four-signal blend — so the Trace tab
    // shows nothing and nobody learns why. Observed cause: ctx and Graphify
    // rooted at different directories for the same project, so ctx returns
    // "backend/x.js" while the graph holds "core/backend/x.js" and nothing
    // matches. Say so once per search rather than never.
    const graphRanked = wasGraphRanked(results);
    if (!graphRanked && resolvedProject && source.length >= 2) {
      logger.warn('search_graph_ranking_inactive', {
        requestId: req.id,
        project: resolvedProject,
        hits: source.length,
        hint: 'A graph exists but matched none of these hits. Usually ctx and Graphify '
          + 'were indexed from different roots for this project — compare a search '
          + 'result path against the keys in graphify-out/graph.json. Ranking has '
          + 'fallen back to semantic relevance only.'
      });
    }

    return res.json({
      results: annotated,
      graphRanked,
      weights: graphRanker.DEFAULT_WEIGHTS,
      activeFile: activeFile || null,
    });
  } catch (err) {
    logSearchFailure(err, { req, query, project: resolvedProject, mode: 'unified' });
    return res.status(500).json({ error: err.message, code: 'search_failed', requestId: req.id });
  }
});

/** Annotate each search hit with spec-drift awareness. */
function annotateSpecFlags(results, projectPath) {
  if (!Array.isArray(results)) return results;
  try {
    const specs = specDrift.readSpecs(projectPath);
    if (!specs || specs.length === 0) return results;

    // Build a map: file → which specs mention it
    const specMentions = new Map();
    for (const spec of specs) {
      const refs = specDrift.extractReferences(spec.text);
      for (const ref of refs) specMentions.set(ref, (specMentions.get(ref) || new Set()).add(spec.id));
    }

    return results.map(r => {
      const file = r?.metadata?.path || r?.path || r?.file || '';
      const mentions = specMentions.get(file) || specMentions.get(file.split('/').pop());
      return {
        ...r,
        specFlag: mentions
          ? { covered: true, specs: [...mentions].slice(0, 3) }
          : { covered: false }
      };
    });
  } catch (_) {
    return results;
  }
}

router.get('/code', async (req, res) => {
  const { query, project, top = 10, activeFile } = req.query;
  if (!query) return res.status(400).send('Query is required');
  const resolvedProject = resolveProjectIdentifier(project);
  const normalizedTop = normalizeTop(top);
  try {
    const raw = await toolBox.searchCode({ query, project: resolvedProject, top: normalizedTop });
    const results = applyGraphRanking(raw, { project: resolvedProject, activeFile, req, mode: 'code' });
    res.json({
      mode: 'code',
      results,
      graphRanked: wasGraphRanked(results),
      weights: graphRanker.DEFAULT_WEIGHTS,
      activeFile: activeFile || null
    });
  } catch (err) {
    logSearchFailure(err, { req, query, project: resolvedProject, mode: 'code' });
    res.status(500).json({ error: err.message, code: 'search_failed', requestId: req.id });
  }
});

router.get('/docs', async (req, res) => {
  const { query, project, top = 10 } = req.query;
  if (!query) return res.status(400).send('Query is required');
  const resolvedProject = resolveProjectIdentifier(project);
  const normalizedTop = normalizeTop(top);
  try {
    const results = await docSearch({ query, project: resolvedProject, top: normalizedTop });
    res.json({ mode: 'doc', results });
  } catch (err) {
    logSearchFailure(err, { req, query, project: resolvedProject, mode: 'doc' });
    res.status(500).json({ error: err.message, code: 'search_failed', requestId: req.id });
  }
});

module.exports = router;
