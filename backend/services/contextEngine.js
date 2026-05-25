// backend/services/contextEngine.js
/**
 * Service layer for handling project indexing with documentation preprocessing.
 * Integrates the docPreprocessor utility to generate documentation chunks
 * before invoking the ContextEngine CLI to index the project.
 */

const path = require('path');
const contextEngine = require('../infrastructure/ContextEngine');
const { preprocessDocumentation, updateCtxConfig } = require('../utils/docPreprocessor');

/**
 * Index a project directory, preprocessing documentation first.
 *
 * @param {string} projectRoot Absolute path to the project root to be indexed.
 * @returns {Promise<{output:string, code:number}>} Result of the ctx indexing command.
 */
async function indexProject(projectRoot) {
  // Resolve to an absolute path for safety.
  const absoluteRoot = path.resolve(projectRoot);

  // Step 1: Generate documentation chunks.
  try {
    await preprocessDocumentation(absoluteRoot);
    // Ensure the generated chunk directories are watched by ctx.
    await updateCtxConfig(absoluteRoot);
    console.log('[ContextEngine Service] Documentation preprocessing completed');
  } catch (preErr) {
    console.error('[ContextEngine Service] Documentation preprocessing failed:', preErr);
    // Continue with indexing even if preprocessing fails; the user may still
    // want code indexing.
  }

  // Step 2: Run the ctx indexing command.
  // Using the infrastructure ContextEngine's execute method for consistency.
  try {
    const result = await contextEngine.execute(['index', absoluteRoot]);
    console.log('[ContextEngine Service] Indexing completed');
    return result;
  } catch (err) {
    console.error('[ContextEngine Service] Indexing error:', err);
    throw err;
  }
}

module.exports = {
  indexProject,
};
