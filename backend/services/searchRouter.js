// backend/services/searchRouter.js
/**
 * /api/search: HTTP over the search pipeline, and nothing more.
 *
 * Every endpoint here calls SearchPipeline.search, which runs all three pillars
 * (Context Expert retrieval, Graphify ranking, OpenSpec tagging). The routes
 * only choose what to retrieve and shape the response. See
 * backend/core/SearchPipeline.js for why the stages are not assembled here.
 */
const express = require('express');
const logger = require('../infrastructure/Logger');
const pipeline = require('../core/SearchPipeline');

const router = express.Router();

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

/** One handler per mode; only the retrieval differs. */
function searchRoute(mode, { defaultTop, label }) {
  return async (req, res) => {
    const { query, project, top = defaultTop, activeFile } = req.query;
    if (!query) return res.status(400).send('Query is required');
    try {
      const out = await pipeline.search({ query, project, mode, top, activeFile, requestId: req.id });
      return res.json(label ? { mode: label, ...out } : out);
    } catch (err) {
      logSearchFailure(err, { req, query, project: pipeline.resolveProject(project), mode: label || mode });
      return res.status(err.status || 500).json({ error: err.message, code: err.code || 'search_failed', requestId: req.id });
    }
  };
}

// Code and docs together: the Search view, MCP, VS Code and mobile.
router.get('/', searchRoute('unified', { defaultTop: 15 }));
// Code only: SearchTrace. It used to stop after Graphify, so no OpenSpec tags.
router.get('/code', searchRoute('code', { defaultTop: 10, label: 'code' }));
// Docs only. It used to be Context Expert alone, unranked and untagged.
router.get('/docs', searchRoute('doc', { defaultTop: 10, label: 'doc' }));

module.exports = router;
