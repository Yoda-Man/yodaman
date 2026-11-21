/**
 * LOAD-BEARING — DO NOT DELETE BECAUSE "NOTHING IMPORTS IT".
 *
 * Loaded at runtime by ToolBox.loadPlugins() (backend/infrastructure/ToolBox.js),
 * which readdirSync()s this directory and require()s each .js file. There is no
 * static import anywhere in the codebase, so knip, IDE "unused file" hints, and
 * any basename-matching scan will all report this file as dead. It is not.
 *
 */
/**
 * Lightsaber — Git Health Map for YodaMan
 * 
 * A YodaMan tool plugin that analyzes Git history to find code hotspots.
 * Reuses yodaman's gitService.js for all Git operations.
 * 
 * YodaMan plugin API: { name, description, permissions, parameters, async execute() }
 * Valid permissions: read, write, command, network, search, unrestricted
 * 
 * Usage via agent or API:
 *   { "name": "lightsaber", "parameters": { "action": "analyze", "workspacePath": "/path/to/repo" } }
 */
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const graphFacts = require('../backend/infrastructure/GraphFacts');
const { isTestFile: isTestPath } = require('../backend/infrastructure/ImpactAnalyzer');

// Reuse yodaman's existing gitService
let gitService;
try {
  gitService = require(path.join(__dirname, '..', 'backend', 'services', 'gitService'));
} catch {
  // Fallback: try relative to cwd (works when running from yodaman root)
  try { gitService = require(path.join(process.cwd(), 'backend', 'services', 'gitService')); }
  catch { /* will error gracefully at runtime */ }
}

// ─── Inline scorers (no need for separate files) ────────────────────────────

// The test and TODO penalties were dead weight: `analyze` only ever passed
// changeFrequency and complexityScore, so `fd.testCoverage` was always
// undefined — always below 50 — and every file took an identical 20-point hit
// while `todoCount` contributed nothing at all. Two of the four advertised
// factors did no work. Both are now supplied per file: coverage from the
// knowledge graph, TODO counts from the scan this plugin already ran.
function healthScore(fd) {
  const cp = Math.min(40, ((fd.changeFrequency||0)/100)*40);
  const xp = Math.min(30, ((fd.complexityScore||0)/100)*30);
  const tp = (fd.testCoverage||0) < 50 ? 20 : 0;
  const dop = Math.min(10, ((fd.todoCount||0)/10)*5);
  const score = Math.max(0, Math.min(100, 100 - (cp+xp+tp+dop)));
  let s, c, l;
  if (score>=80) { s='healthy'; c='#57c785'; l='Healthy 🟢'; }
  else if (score>=60) { s='warning'; c='#e6c35c'; l='Warning 🟡'; }
  else if (score>=40) { s='atRisk'; c='#ff8c42'; l='At Risk 🟠'; }
  else if (score>=20) { s='hotspot'; c='#ff4444'; l='Hotspot 🔴'; }
  else { s='critical'; c='#cc0000'; l='Critical 🔥'; }
  return { score: Math.round(score), status:s, color:c, label:l,
    penalties: { change:Math.round(cp), complexity:Math.round(xp), test:tp, todo:dop } };
}

/**
 * The first `limit` lines a command prints. Arguments go to the program as an
 * array, never through a shell, so a workspace path cannot run anything.
 * Resolves on any exit code: grep exits 1 when nothing matches, and find exits 1
 * on one unreadable folder, and both still printed what they found.
 */
function outputLines(command, args, limit) {
  return new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 64 * 1024 * 1024 }, (_err, stdout = '') => {
      resolve(String(stdout).split('\n').filter(Boolean).slice(0, limit));
    });
  });
}

/** grep -rn for TODO/FIXME/HACK in JS and TS sources, outside generated folders. */
function grepTodos(workspacePath) {
  return outputLines('grep', [
    '-rn', '-e', 'TODO', '-e', 'FIXME', '-e', 'HACK',
    '--include=*.js', '--include=*.ts', '--include=*.jsx', '--include=*.tsx',
    '--exclude-dir=node_modules', '--exclude-dir=dist', '--exclude-dir=build', '--exclude-dir=.git',
    '--exclude-dir=release', '--exclude-dir=coverage',
    '--', workspacePath
  ], 500);
}

/**
 * Per-file TODO/FIXME/HACK counts, keyed by workspace-relative path so they line
 * up with the git heatmap. The `find-todos` action already gathered this; the
 * health score just never received it.
 */
async function countTodosByFile(workspacePath) {
  const counts = {};
  for (const line of await grepTodos(workspacePath)) {
    const absolute = line.split(':')[0];
    const relative = path.relative(workspacePath, absolute).split(path.sep).join('/');
    if (relative) counts[relative] = (counts[relative] || 0) + 1;
  }
  return counts;
}

function calcComplexity(content) {
  const lines = content.split('\n');
  const nonEmpty = lines.filter(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#')).length;
  let maxIndent = 0;
  for (const l of lines) { const ind = l.match(/^\s*/)[0].length; maxIndent = Math.max(maxIndent, Math.floor(ind/2)); }
  // Branch keywords, plus && || and the ternary ?. Built as `\b?\b`, the `?` threw
  // "Nothing to repeat", so every file scored zero and no hotspot was ever found.
  const branches = (content.match(/\b(?:if|for|while|case|catch)\b/g) || []).length
    + (content.match(/&&|\|\||(?<!\?)\?(?![.?])/g) || []).length;
  const cc = Math.min(1 + branches, 200);
  return { loc:nonEmpty, nestingDepth:maxIndent, cyclomaticComplexity:cc, complexityScore:Math.min(100,(cc/200)*100) };
}

/**
 * A glob as git and .gitignore read it: `*` stays inside one path segment,
 * `**` crosses them, and the match starts at a segment boundary and runs to the
 * end, so `*.lock` drops `yarn.lock` but not `src/clock.js`.
 */
function globToRegExp(glob) {
  const body = glob.split('**')
    .map(part => part.split('*').map(text => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('.*');
  return new RegExp(`(^|/)${body}$`);
}

/**
 * Files that change together, from the diffs of the most recent commits in the
 * window. Strength is the share of the diffed commits that touched both files.
 */
async function couplingFor(workspacePath, { commitLimit, inWindow, includeFile }) {
  // Only this many are diffed, so only this many are fetched: dividing by 200
  // fetched commits while diffing 100 capped every strength at 50%.
  const commits = (await gitService.getCommitHistory(workspacePath, null, Math.min(commitLimit, 100)).catch(() => [])).filter(inWindow);
  const counts = new Map();
  let diffed = 0;
  for (const c of commits) {
    try {
      const diff = await gitService.getCommitDiff(workspacePath, c.hash);
      diffed += 1;
      const files = diff.files.map(f => f.filePath).filter(f => includeFile(f)).sort();
      for (let i = 0; i < files.length; i++) for (let j = i+1; j < files.length; j++) {
        const k = `${files[i]}|${files[j]}`; counts.set(k, (counts.get(k)||0)+1);
      }
    } catch (_err) {
      // A single unreadable commit (shallow clone, rewritten history) must
      // not void the whole coupling analysis — skip it and keep going.
    }
  }
  const couplingEdges = Array.from(counts.entries())
    .map(([k,c]) => { const [f1,f2]=k.split('|'); return { file1:f1, file2:f2, coChangeCount:c, strength:(c/Math.max(diffed,1))*100 }; })
    .sort((a,b) => b.strength - a.strength).slice(0, 100);
  return { couplingEdges, clusters: calcCouplingClusters(couplingEdges) };
}

function calcCouplingClusters(coupling) {
  const g = new Map();
  for (const e of coupling) {
    if (e.strength > 30) {
      if (!g.has(e.file1)) g.set(e.file1,[]); if (!g.has(e.file2)) g.set(e.file2,[]);
      g.get(e.file1).push(e.file2); g.get(e.file2).push(e.file1);
    }
  }
  const visited = new Set(), clusters = [];
  for (const [node] of g) {
    if (!visited.has(node)) {
      const c = [], q = [node]; visited.add(node);
      while (q.length) { const n = q.shift(); c.push(n); for (const nb of (g.get(n)||[])) if (!visited.has(nb)) { visited.add(nb); q.push(nb); } }
      if (c.length > 1) clusters.push({ files:c, size:c.length });
    }
  }
  return clusters.sort((a,b) => b.size - a.size);
}

// ─── Main plugin export ────────────────────────────────────────────────

module.exports = {
  name: 'lightsaber',
  description: 'Analyze Git history to find code hotspots — files that change frequently, are complex, and have poor test coverage. Returns health scores, change coupling, and refactoring priorities.\n\n💡 Chat usage: "Find hotspots in my repo" or "What files need refactoring?" or "Run lightsaber on this workspace"',
  permissions: ['read', 'search'],
  parameters: {
    action: {
      type: 'string',
      required: true,
      enum: ['analyze', 'find-hotspots', 'find-todos', 'test-coverage', 'coupling', 'report'],
      description: 'Analysis action to perform'
    },
    workspacePath: {
      type: 'string',
      required: true,
      description: 'Absolute path to the Git repository to analyze'
    },
    commitLimit: {
      type: 'number',
      default: 500,
      description: 'Max commits to analyze'
    },
    daysToAnalyze: {
      type: 'number',
      default: 90,
      description: 'Time window in days'
    },
    excludePatterns: {
      type: 'array',
      default: ['node_modules/**', 'dist/**', 'build/**', '*.lock', 'package-lock.json'],
      description: 'Glob patterns to exclude'
    }
  },

  async execute(params = {}) {
    const { action, commitLimit = 500, daysToAnalyze = 90, excludePatterns } = params;
    if (!params.workspacePath) throw new Error('workspacePath is required');
    // Absolute, so it can never be read as an option by grep, find or git.
    const workspacePath = path.resolve(params.workspacePath);
    // The window `daysToAnalyze` promises: the heatmap and the commits sampled for coupling.
    const days = Math.max(1, Number(daysToAnalyze) || 90);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const inWindow = (commit) => !commit.date || Date.parse(commit.date) >= since;
    // Only the git actions need it: find-todos and test-coverage work without git.
    const requireGit = () => {
      if (!gitService) throw new Error('Cannot load gitService from yodaman. Ensure yodaman/backend/services/gitService.js is accessible.');
    };

    const codeExts = ['.js','.ts','.jsx','.tsx','.py','.java','.go','.rs','.dart','.swift'];
    const exPats = excludePatterns || ['node_modules/**','dist/**','build/**','*.lock','package-lock.json'];
    const exRegExps = exPats.map(globToRegExp);
    const includeFile = (f) => {
      if (exRegExps.some(r => r.test(f))) return false;
      return codeExts.some(e => f.endsWith(e));
    };

    // --- analyze ---
    if (action === 'analyze' || action === 'find-hotspots' || action === 'report') {
      requireGit();
      const heatmap = await gitService.getHeatmapData(workspacePath, days).catch(() => []);
      const filtered = heatmap.filter(e => includeFile(e.filePath));
      const maxC = Math.max(...filtered.map(v => v.changeCount), 1);
      const changeData = filtered.map(e => ({ path: e.filePath, commitCount: e.changeCount, changeFrequency: (e.changeCount/maxC)*100, lastChange: e.lastChangeDate, authorCount: e.authorCount }));

      const complexityData = {};
      for (const f of changeData.slice(0, 100)) {
        try { const c = await fs.promises.readFile(path.join(workspacePath, f.path), 'utf-8'); complexityData[f.path] = calcComplexity(c); }
        catch { complexityData[f.path] = { loc:0, nestingDepth:0, cyclomaticComplexity:0, complexityScore:0 }; }
      }

      // Which tests actually reach each file, from resolved graph edges. A file
      // with no covering test is the case worth surfacing, so treat presence of
      // any covering test as covered and absence as uncovered.
      const coverage = graphFacts.coverageByFile(workspacePath) || new Map();
      const todosByFile = await countTodosByFile(workspacePath);

      const scores = {};
      for (const f of changeData.slice(0, 100)) {
        const cd = complexityData[f.path] || {};
        const coveringTests = coverage.get(f.path) || [];
        scores[f.path] = healthScore({
          changeFrequency: f.changeFrequency,
          complexityScore: cd.complexityScore,
          testCoverage: coveringTests.length > 0 ? 100 : 0,
          todoCount: todosByFile[f.path] || 0
        });
        scores[f.path].coveringTests = coveringTests.length;
        scores[f.path].todoCount = todosByFile[f.path] || 0;
      }

      const uncovered = Object.entries(scores)
        .filter(([, health]) => health.coveringTests === 0)
        .map(([file]) => file);

      const hotspots = Object.entries(scores).filter(([_,h]) => h.score < 40).map(([p,h]) => ({ path:p, score:h.score, status:h.status })).sort((a,b) => a.score - b.score);

      if (action === 'find-hotspots') return {
        hotspots,
        totalFiles: changeData.length,
        uncoveredCount: uncovered.length,
        uncoveredFiles: uncovered.slice(0, 20),
        averageHealth: Math.round(Object.values(scores).reduce((a,b)=>a+b.score,0)/Math.max(Object.keys(scores).length,1))
      };
      if (action === 'analyze') return { hotspots: hotspots.slice(0, 10), changeData: changeData.slice(0, 50), complexityData, scores };

      // report — full dump
      const { couplingEdges, clusters } = await couplingFor(workspacePath, { commitLimit, inWindow, includeFile });

      return { generatedAt: new Date().toISOString(), workspace: workspacePath, totalFiles: changeData.length, averageHealth: Math.round(Object.values(scores).reduce((a,b)=>a+b.score,0)/Math.max(Object.keys(scores).length,1)), hotspotCount: hotspots.length, hotspots: hotspots.slice(0, 20), coupling: couplingEdges, clusters };
    }

    // --- find-todos ---
    if (action === 'find-todos') {
      const lines = await grepTodos(workspacePath);
      const byFile = {}; for (const l of lines) { const f = l.split(':')[0]; byFile[f] = (byFile[f]||0)+1; }
      return { total: lines.length, byFile, lines: lines.slice(0, 100) };
    }

    // --- test-coverage ---
    if (action === 'test-coverage') {
      // Counting test files against source files says nothing about whether any
      // given file is tested — a repo with one enormous test file scores well.
      // The graph knows which tests actually reach which sources, so report that
      // and name the files nothing exercises.
      const facts = graphFacts.load(workspacePath);
      if (facts) {
        const coverage = graphFacts.coverageByFile(workspacePath, { facts }) || new Map();
        // Source files only — a test file covering itself is not a measurement.
        const sources = [...facts.files].filter(f => includeFile(f) && !isTestPath(f));
        const uncovered = sources.filter(f => !coverage.has(f));
        const covered = sources.length - uncovered.length;

        const percentCovered = sources.length ? Math.round((covered / sources.length) * 100) : 0;

        return {
          method: 'knowledge-graph',
          sourceFiles: sources.length,
          coveredFiles: covered,
          uncoveredFiles: uncovered.length,
          percentCovered,
          // Kept so existing consumers of this plugin keep working — but it now
          // means "percent of source files a test actually reaches" rather than
          // the old ratio of test files to source files.
          ratio: percentCovered,
          // Ordered by how much of the codebase leans on each untested file.
          leastCoveredHighTraffic: uncovered
            .map(file => ({ file, dependents: facts.dependedOnBy.get(file)?.size || 0 }))
            .sort((a, b) => b.dependents - a.dependents)
            .slice(0, 15),
          note: 'Covered means at least one test file reaches this file through resolved import edges.'
        };
      }

      // No graph — fall back to the old ratio, labelled honestly.
      // node_modules excluded here too: its packages' own tests pushed the ratio past 100%.
      const testFiles = await outputLines('find', [workspacePath, '(', '-name', '*.test.*', '-o', '-name', '*.spec.*', ')', '-not', '-path', '*/node_modules/*'], 200);
      const srcFiles = await outputLines('find', [workspacePath, '-name', '*.js', '-not', '-name', '*.test.*', '-not', '-name', '*.spec.*', '-not', '-path', '*/node_modules/*'], 500);
      return {
        method: 'file-count-fallback',
        note: 'No knowledge graph for this workspace. This is a ratio of test files to source files, not a measure of what is actually tested.',
        ratio: srcFiles.length > 0 ? Math.round(testFiles.length / srcFiles.length * 100) : 0,
        testFiles: testFiles.length,
        sourceFiles: srcFiles.length
      };
    }

    // --- coupling ---
    if (action === 'coupling') {
      requireGit();
      return couplingFor(workspacePath, { commitLimit, inWindow, includeFile });
    }

    throw new Error(`Unknown action: ${action}. Valid actions: analyze, find-hotspots, find-todos, test-coverage, coupling, report`);
  }
};
