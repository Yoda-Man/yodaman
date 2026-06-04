// backend/services/searchRouter.js
/**
 * Search Router – hybrid routing for code vs documentation queries.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { classifyQuery } = require('../utils/queryClassifier');
const toolBox = require('../infrastructure/ToolBox');
const { preprocessDocumentation, updateCtxConfig } = require('../utils/docPreprocessor');
const logger = require('../infrastructure/Logger');

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
  const { query, project, top = 10 } = req.query;
  if (!query) return res.status(400).send('Query is required');
  const mode = classifyQuery(query);
  const resolvedProject = resolveProjectIdentifier(project);
  const normalizedTop = normalizeTop(top);
  try {
    if (mode === 'doc') {
      const results = await docSearch({ query, project: resolvedProject, top: normalizedTop });
      return res.json({ mode: 'doc', results });
    }
    // default to code search
    const results = await toolBox.searchCode({ query, project: resolvedProject, top: normalizedTop });
    return res.json({ mode: 'code', results });
  } catch (err) {
    logSearchFailure(err, { req, query, project: resolvedProject, mode });
    return res.status(500).json({ error: err.message, code: 'search_failed', requestId: req.id });
  }
});

router.get('/code', async (req, res) => {
  const { query, project, top = 10 } = req.query;
  if (!query) return res.status(400).send('Query is required');
  const resolvedProject = resolveProjectIdentifier(project);
  const normalizedTop = normalizeTop(top);
  try {
    const results = await toolBox.searchCode({ query, project: resolvedProject, top: normalizedTop });
    res.json({ mode: 'code', results });
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
