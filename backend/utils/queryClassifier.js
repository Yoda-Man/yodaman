// backend/utils/queryClassifier.js
/**
 * Simple query classifier for YodaMan.
 * Determines whether a user query is about code or documentation.
 *
 * Heuristics used:
 *   • Presence of code‑related keywords (function, class, import, export, const, let, var, require, module.exports)
 *   • Presence of file‑type patterns (e.g., *.js, *.ts, *.py, *.java, *.md, README)
 *   • Query length and punctuation – very short queries with symbols are likely code.
 *   • Presence of documentation‑related words (readme, guide, tutorial, api, documentation, how to, explain)
 *
 * Returns one of: "code", "doc".
 */

function isCodeQuery(query) {
  const lower = query.toLowerCase();
  const codeKeywords = [
    'function', 'class', 'def ', 'import ', 'export ', 'require(', 'module.exports',
    'const ', 'let ', 'var ', 'return ', '=>', 'await ', 'async ', 'type ', '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.cpp', '.c', '.go'
  ];
  return codeKeywords.some(k => lower.includes(k));
}

function isDocQuery(query) {
  const lower = query.toLowerCase();
  const docKeywords = [
    'readme', 'guide', 'tutorial', 'api', 'documentation', 'how to', 'explain', 'what does', 'describe', 'usage', 'example', '.md', '.rst', '.txt', '.adoc'
  ];
  return docKeywords.some(k => lower.includes(k));
}

/**
 * Classify a query string.
 * @param {string} query - The user input.
 * @returns {'code'|'doc'} - Classification result.
 */
function classifyQuery(query) {
  if (!query || typeof query !== 'string') return 'code'; // default fallback
  const trimmed = query.trim();
  // Prefer documentation detection if strong signals
  if (isDocQuery(trimmed) && !isCodeQuery(trimmed)) return 'doc';
  if (isCodeQuery(trimmed) && !isDocQuery(trimmed)) return 'code';
  // When both or none match, fallback to length heuristic: short snippets -> code
  const words = trimmed.split(/\s+/).length;
  return words <= 4 ? 'code' : 'doc';
}

module.exports = { classifyQuery };
