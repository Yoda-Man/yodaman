/**
 * Documentation Preprocessor for YodaMan
 * ---------------------------------------------------------------
 * This utility scans configured project directories for documentation
 * files (Markdown, reST, plain text, AsciiDoc) and extracts JSDoc
 * comment blocks from JavaScript/TypeScript sources. Each discovered
 * section is written to a hidden ".yodaman-doc-chunks" directory as a
 * separate file with a YAML front‑matter block that contains metadata
 * useful for the `ctx` CLI indexer.
 * ---------------------------------------------------------------
 */

const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');
const logger = require('../infrastructure/Logger');

// -----------------------------------------------------------------
// Configuration – can be tweaked without touching the rest of the code.
// -----------------------------------------------------------------
const DOC_EXTENSIONS = ['.md', '.markdown', '.rst', '.txt', '.adoc'];
// Hidden directory (relative to each watched folder) that stores chunks.
const OUTPUT_DIR = '.yodaman-doc-chunks';

/**
 * Split a markdown (or generic text) file into heading‑based chunks.
 * Each chunk contains the heading text, its level, the raw content and
 * file metadata such as line numbers. The algorithm walks the file line‑
 * by line, starting a new chunk whenever a markdown heading (`#…`) is
 * encountered.
 *
 * @param {string} filePath Absolute path to the documentation file.
 * @returns {Array<Object>} Array of chunk descriptors.
 */
function splitByHeadings(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const chunks = [];
  let currentHeading = 'root';
  let currentLevel = 0;
  let currentContent = [];
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // Emit previous chunk if it has any content.
      if (currentContent.length > 0) {
        chunks.push({
          heading: currentHeading,
          level: currentLevel,
          content: currentContent.join('\n').trim(),
          filePath: path.relative(process.cwd(), filePath),
          startLine,
          endLine: i,
          type: 'doc-section'
        });
      }
      // Start a new chunk.
      currentHeading = headingMatch[2];
      currentLevel = headingMatch[1].length;
      currentContent = [line];
      startLine = i + 1;
    } else {
      currentContent.push(line);
    }
  }

  // Final chunk.
  if (currentContent.length > 0) {
    chunks.push({
      heading: currentHeading,
      level: currentLevel,
      content: currentContent.join('\n').trim(),
      filePath: path.relative(process.cwd(), filePath),
      startLine,
      endLine: lines.length,
      type: 'doc-section'
    });
  }
  return chunks;
}

/**
 * Extract JSDoc comment blocks from a JavaScript/TypeScript source file.
 * The extracted comment is treated as a documentation chunk with a
 * synthetic heading derived from `@description` / `@summary` tags or the
 * first line of the comment.
 *
 * @param {string} filePath Absolute path to the source file.
 * @returns {Array<Object>} Array of JSDoc chunk descriptors.
 */
function extractJSDocComments(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const jsdocRegex = /\/\*\*([\s\S]*?)\*\//g;
  const comments = [];
  let match;
  while ((match = jsdocRegex.exec(content)) !== null) {
    const raw = match[1].trim();
    const lines = raw.split('\n').map(l => l.replace(/^\s*\*\s?/, ''));
    // Derive a heading – prefer @description / @summary tags.
    let heading = lines[0] || 'JSDoc';
    const descMatch = raw.match(/@description\s+(.+)/i) || raw.match(/@summary\s+(.+)/i);
    if (descMatch) heading = descMatch[1].trim();

    const startLine = content.substr(0, match.index).split('\n').length;
    comments.push({
      heading,
      level: 2,
      content: raw,
      filePath: path.relative(process.cwd(), filePath),
      startLine,
      type: 'jsdoc'
    });
  }
  return comments;
}

/**
 * Main entry point – called before a `ctx index` operation. It walks the
 * supplied directories, creates chunk files and returns a flat list of
 * all generated chunks (useful for debugging or logging).
 *
 * @param {string|Array<string>} directories A single directory or an array.
 * @returns {Promise<Array<Object>>} All created chunk descriptors.
 */
async function preprocessDocumentation(directories) {
  const dirs = Array.isArray(directories) ? directories : [directories];
  const allChunks = [];
  for (const dir of dirs) {
    const chunkDir = path.join(dir, OUTPUT_DIR);
    await fs.ensureDir(chunkDir);

    // -----------------------------------------------------------------
    // Process Markdown / reST / plain‑text documentation files.
    // -----------------------------------------------------------------
    for (const ext of DOC_EXTENSIONS) {
      const pattern = `${dir}/**/*${ext}`;
      const files = glob.sync(pattern, { ignore: '**/node_modules/**' });
      for (const file of files) {
        const chunks = splitByHeadings(file);
        allChunks.push(...chunks);
        // Write each chunk to its own file – the `.doc-chunk` extension is
        // understood by the `ctx` CLI as an indexable text document.
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const safeHeading = chunk.heading.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
          const chunkFile = path.join(chunkDir, `${path.basename(file)}_${safeHeading}_${i}.doc-chunk`);
          const yaml = `---\nheading: ${chunk.heading}\nlevel: ${chunk.level}\nsource: ${chunk.filePath}\nlines: ${chunk.startLine}-${chunk.endLine}\ntype: ${chunk.type}\n---\n\n${chunk.content}`;
          await fs.writeFile(chunkFile, yaml, 'utf8');
        }
      }
    }

    // -----------------------------------------------------------------
    // Process JSDoc comments inside source files.
    // -----------------------------------------------------------------
    const jsFiles = glob.sync(`${dir}/**/*.{js,ts,jsx,tsx}`, { ignore: '**/node_modules/**' });
    for (const file of jsFiles) {
      const comments = extractJSDocComments(file);
      for (let i = 0; i < comments.length; i++) {
        const comment = comments[i];
        const chunkFile = path.join(chunkDir, `${path.basename(file)}_jsdoc_${i}.doc-chunk`);
        const yaml = `---\ntype: jsdoc\nfunction: ${comment.heading}\nsource: ${comment.filePath}\nlines: ${comment.startLine}\n---\n\n${comment.content}`;
        await fs.writeFile(chunkFile, yaml, 'utf8');
      }
      allChunks.push(...comments);
    }
  }
  logger.info('doc_chunks_generated', { count: allChunks.length });
  return allChunks;
}

/**
 * Ensure that the generated chunk directories are included in YodaMan's
 * `config.json` `watchedDirectories` list so that the `ctx` indexer will
 * pick them up automatically.
 *
 * @param {string} projectRoot Absolute path to the project root (where
 *   `config.json` lives).
 */
async function updateCtxConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'config.json');
  if (!await fs.pathExists(configPath)) {
    logger.warn('doc_config_missing', { detail: 'skipping config update' });
    return;
  }
  const config = await fs.readJson(configPath);
  // Normalise watchedDirectories to an array of strings.
  const watched = Array.isArray(config.watchedDirectories) ? config.watchedDirectories : [];
  const chunkDirs = watched.map(dir => path.join(dir, OUTPUT_DIR));
  // Merge, dedupe.
  const newWatched = [...new Set([...watched, ...chunkDirs])];
  config.watchedDirectories = newWatched;
  await fs.writeJson(configPath, config, { spaces: 2 });
  logger.info('doc_config_updated');
}

module.exports = {
  preprocessDocumentation,
  splitByHeadings,
  extractJSDocComments,
  updateCtxConfig
};
