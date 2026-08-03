/**
 * Droid-Sweep — YodaMan plugin: find unused files in a project.
 * @author Marwa Trust Mutemasango <trustaldo@gmail.com>
 *
 * Dead code is a graph reachability question, so this asks the Graphify graph,
 * which holds import edges resolved by a real parser.
 *
 * The previous implementation matched each file's *basename* against the text of
 * every other file. That reported a file as referenced whenever its name merely
 * appeared in a string, treated two files sharing a basename as one, and missed
 * aliased and dynamic imports entirely. It also re-read the whole tree on every
 * run to rebuild information the graph already had.
 *
 * The text scan is kept as a fallback for workspaces with no graph yet, and the
 * response says which method produced the answer so the numbers can be trusted
 * accordingly.
 */
const fs = require('fs');
const path = require('path');
const graphFacts = require('../backend/infrastructure/GraphFacts');

const DEFAULT_EXTENSIONS = '.js,.ts,.jsx,.tsx';
const DEFAULT_EXCLUDES = 'node_modules,dist,build,.git,.next,.venv';

/** Legacy text scan. Only used when no graph is available. */
function scanByText(root, exts, skip) {
  const allFiles = [];
  const walk = (dir, depth = 0) => {
    if (depth > 10) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(full, depth + 1);
      } else if (entry.isFile() && exts.has(path.extname(entry.name))) {
        allFiles.push(full);
      }
    }
  };
  walk(root);

  const contents = {};
  for (const file of allFiles) {
    try { contents[file] = fs.readFileSync(file, 'utf8'); } catch { contents[file] = ''; }
  }

  const referenced = new Set();
  const entryNames = new Set(['index.js', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.tsx', 'index.jsx', 'index.tsx']);
  for (const file of allFiles) if (entryNames.has(path.basename(file))) referenced.add(file);

  for (const [filePath, content] of Object.entries(contents)) {
    const base = path.basename(filePath).replace(path.extname(filePath), '');
    const pattern = new RegExp(`['"\`](\\.\\.?/.*?)?${base}['"\`]`, 'g');
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const importPath = match[1] ? match[1] + base : base;
      if (!importPath.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(filePath), importPath);
      for (const ext of exts) {
        if (fs.existsSync(resolved + ext)) referenced.add(resolved + ext);
        if (fs.existsSync(path.join(resolved, `index${ext}`))) referenced.add(path.join(resolved, `index${ext}`));
      }
    }
  }

  const unused = allFiles
    .filter(file => !referenced.has(file))
    .map(file => ({
      filePath: file.replace(root, '').replace(/^[/\\]/, ''),
      size: (contents[file] || '').length,
      loc: (contents[file] || '').split('\n').length
    }));

  return { totalFiles: allFiles.length, unused };
}

/** Measure the files the graph flagged, so output matches the legacy shape. */
function measure(root, relativePath) {
  try {
    const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
    return { size: content.length, loc: content.split('\n').length };
  } catch {
    return { size: 0, loc: 0 };
  }
}

module.exports = {
  name: 'Droid-Sweep',
  description: 'Find unused files using the workspace knowledge graph — resolved import edges, not text matching. Reports what each candidate still imports so genuinely abandoned code sorts first. 💡 Chat usage: "Find unused files" or "Run Droid Sweep" or "Clean up dead code"',
  permissions: ['read'],
  parameters: {
    workspacePath: { type: 'string', required: true, description: 'Absolute path to scan' },
    extensions: { type: 'string', default: DEFAULT_EXTENSIONS, description: 'Comma-separated extensions' },
    excludeDirs: { type: 'string', default: DEFAULT_EXCLUDES, description: 'Comma-separated dirs to skip (text-scan fallback only)' },
    includeTests: { type: 'boolean', default: false, description: 'Include test files, which a runner loads without any import' }
  },

  async execute(params = {}) {
    const root = path.resolve(params.workspacePath || process.cwd());
    const extensionList = (params.extensions || DEFAULT_EXTENSIONS).split(',').map(s => s.trim()).filter(Boolean);
    const exts = new Set(extensionList);
    const skip = new Set((params.excludeDirs || DEFAULT_EXCLUDES).split(',').map(s => s.trim()));

    const facts = graphFacts.load(root);

    if (facts) {
      const orphans = graphFacts.orphanFiles(root, {
        extensions: extensionList,
        includeTests: Boolean(params.includeTests),
        facts
      }) || [];

      return {
        workspace: root,
        method: 'knowledge-graph',
        confidence: 'high',
        note: 'Unused means no resolved import edge points at the file. Entry points, config, and dynamically loaded plugins are excluded.',
        totalFiles: facts.files.size,
        unusedCount: orphans.length,
        unusedFiles: orphans.slice(0, 50).map(orphan => ({
          filePath: orphan.file,
          stillImports: orphan.imports,
          isTest: orphan.isTest,
          ...measure(root, orphan.file)
        }))
      };
    }

    // No graph for this workspace yet — fall back, and say so.
    const { totalFiles, unused } = scanByText(root, exts, skip);
    return {
      workspace: root,
      method: 'text-scan-fallback',
      confidence: 'low',
      note: 'No knowledge graph for this workspace, so results come from basename text matching. Aliased and dynamic imports may be missed and files sharing a basename can be conflated. Build the graph for an accurate answer.',
      totalFiles,
      unusedCount: unused.length,
      unusedFiles: unused.sort((a, b) => b.loc - a.loc).slice(0, 50)
    };
  }
};
