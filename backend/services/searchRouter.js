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
const searchSummary = require('../core/SearchSummary');

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

// Code and docs together: MCP, VS Code and mobile. The Search view uses /stream.
router.get('/', searchRoute('unified', { defaultTop: 15 }));
// Code only: SearchTrace. It used to stop after Graphify, so no OpenSpec tags.
router.get('/code', searchRoute('code', { defaultTop: 10, label: 'code' }));
// Docs only. It used to be Context Expert alone, unranked and untagged.
router.get('/docs', searchRoute('doc', { defaultTop: 10, label: 'doc' }));

/**
 * The Search view, as a stream: the pipeline's results the moment they exist,
 * then the local model's summary of those same results. Results never wait for
 * the model, which takes seconds. Events: results, summary_start, summary,
 * summary_error, search_error, done.
 */
router.get('/stream', async (req, res) => {
  const { query, project, top = 15, activeFile } = req.query;
  if (!query) return res.status(400).send('Query is required');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // The user started another search or left: stop the model, it costs GPU time.
  const stop = new AbortController();
  res.on('close', () => stop.abort());

  let out;
  try {
    out = await pipeline.search({ query, project, mode: 'unified', top, activeFile, requestId: req.id });
  } catch (err) {
    logSearchFailure(err, { req, query, project: pipeline.resolveProject(project), mode: 'unified' });
    send('search_error', { error: err.message, code: err.code || 'search_failed', requestId: req.id });
    return res.end();
  }
  send('results', out);

  if (out.results.length && !stop.signal.aborted) {
    try {
      send('summary_start', { model: await searchSummary.localModel() });
      for await (const text of searchSummary.summarize({ query, results: out.results, signal: stop.signal })) send('summary', { text });
    } catch (err) {
      if (!stop.signal.aborted) {
        // The results already arrived; a missing summary is degraded, not failed.
        logger.warn('search_summary_failed', { requestId: req.id, query, reason: err.message });
        send('summary_error', { error: err.message });
      }
    }
  }
  send('done', {});
  return res.end();
});

module.exports = router;
