// backend/services/searchRouter.js
/**
 * Search Router – hybrid routing for code vs documentation queries.
 */
const express = require('express');
const router = express.Router();
const { classifyQuery } = require('../utils/queryClassifier');
const toolBox = require('../infrastructure/ToolBox');
const { preprocessDocumentation, updateCtxConfig } = require('../utils/docPreprocessor');
const contextEngine = require('../infrastructure/ContextEngine');

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
  try {
    if (mode === 'doc') {
      const results = await docSearch({ query, project, top });
      return res.json({ mode: 'doc', results });
    }
    // default to code search
    const results = await toolBox.searchCode({ query, project, top });
    return res.json({ mode: 'code', results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/code', async (req, res) => {
  const { query, project, top = 10 } = req.query;
  if (!query) return res.status(400).send('Query is required');
  try {
    const results = await toolBox.searchCode({ query, project, top });
    res.json({ mode: 'code', results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/docs', async (req, res) => {
  const { query, project, top = 10 } = req.query;
  if (!query) return res.status(400).send('Query is required');
  try {
    const results = await docSearch({ query, project, top });
    res.json({ mode: 'doc', results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
