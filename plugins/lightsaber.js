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

function calcComplexity(content) {
  const lines = content.split('\n');
  const nonEmpty = lines.filter(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#')).length;
  let maxIndent = 0;
  for (const l of lines) { const ind = l.match(/^\s*/)[0].length; maxIndent = Math.max(maxIndent, Math.floor(ind/2)); }
  let complex = 1;
  for (const d of ['if','for','while','case','catch','&&','||','?']) {
    const rx = new RegExp(`\\b${d}\\b`,'g'); const m = content.match(rx); if (m) complex += m.length;
  }
  const cc = Math.min(complex, 200);
  return { loc:nonEmpty, nestingDepth:maxIndent, cyclomaticComplexity:cc, complexityScore:Math.min(100,(cc/200)*100) };
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
    const { action, workspacePath, commitLimit = 500, daysToAnalyze = 90, excludePatterns } = params;
    if (!workspacePath) throw new Error('workspacePath is required');
    if (!gitService) throw new Error('Cannot load gitService from yodaman. Ensure yodaman/backend/services/gitService.js is accessible.');

    const codeExts = ['.js','.ts','.jsx','.tsx','.py','.java','.go','.rs','.dart','.swift'];
    const exPats = excludePatterns || ['node_modules/**','dist/**','build/**','*.lock','package-lock.json'];
    const includeFile = (f) => {
      for (const p of exPats) { const r = new RegExp(p.replace(/\*\*/g,'.*').replace(/\*/g,'[^/]*')); if (r.test(f)) return false; }
      return codeExts.some(e => f.endsWith(e));
    };

    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execP = promisify(exec);

    // --- analyze ---
    if (action === 'analyze' || action === 'find-hotspots' || action === 'report') {
      const heatmap = await gitService.getHeatmapData(workspacePath).catch(() => []);
      const filtered = heatmap.filter(e => includeFile(e.filePath));
      const maxC = Math.max(...filtered.map(v => v.changeCount), 1);
      const changeData = filtered.map(e => ({ path: e.filePath, commitCount: e.changeCount, changeFrequency: (e.changeCount/maxC)*100, lastChange: e.lastChangeDate, authorCount: e.authorCount }));

      const complexityData = {};
      for (const f of changeData.slice(0, 100)) {
        try { const c = await fs.promises.readFile(path.join(workspacePath, f.path), 'utf-8'); complexityData[f.path] = calcComplexity(c); }
        catch { complexityData[f.path] = { loc:0, nestingDepth:0, cyclomaticComplexity:0, complexityScore:0 }; }
      }

      const scores = {};
      for (const f of changeData.slice(0, 100)) {
        const cd = complexityData[f.path] || {};
        scores[f.path] = healthScore({ changeFrequency: f.changeFrequency, complexityScore: cd.complexityScore });
      }

      const hotspots = Object.entries(scores).filter(([_,h]) => h.score < 40).map(([p,h]) => ({ path:p, score:h.score, status:h.status })).sort((a,b) => a.score - b.score);

      if (action === 'find-hotspots') return { hotspots, totalFiles: changeData.length, averageHealth: Math.round(Object.values(scores).reduce((a,b)=>a+b.score,0)/Math.max(Object.keys(scores).length,1)) };
      if (action === 'analyze') return { hotspots: hotspots.slice(0, 10), changeData: changeData.slice(0, 50), complexityData, scores };

      // report — full dump
      const commits = await gitService.getCommitHistory(workspacePath, null, Math.min(commitLimit, 200)).catch(() => []);
      const coupling = [];
      for (const c of commits.slice(0, 100)) {
        try {
          const diff = await gitService.getCommitDiff(workspacePath, c.hash);
          const files = diff.files.map(f => f.filePath).filter(f => includeFile(f)).sort();
          for (let i = 0; i < files.length; i++) for (let j = i+1; j < files.length; j++) coupling.push({ file1:files[i], file2:files[j], commit:c.hash });
        } catch {}
      }
      const couplingStrength = new Map();
      for (const e of coupling) { const k = `${e.file1}|${e.file2}`; couplingStrength.set(k, (couplingStrength.get(k)||0)+1); }
      const couplingEdges = Array.from(couplingStrength.entries()).map(([k,c]) => { const [f1,f2]=k.split('|'); return { file1:f1, file2:f2, coChangeCount:c, strength:(c/commits.length)*100 }; }).sort((a,b) => b.strength - a.strength).slice(0, 100);
      const clusters = calcCouplingClusters(couplingEdges);

      return { generatedAt: new Date().toISOString(), workspace: workspacePath, totalFiles: changeData.length, averageHealth: Math.round(Object.values(scores).reduce((a,b)=>a+b.score,0)/Math.max(Object.keys(scores).length,1)), hotspotCount: hotspots.length, hotspots: hotspots.slice(0, 20), coupling: couplingEdges, clusters };
    }

    // --- find-todos ---
    if (action === 'find-todos') {
      const { stdout } = await execP(`grep -rn "TODO\\|FIXME\\|HACK" --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" "${workspacePath}" 2>/dev/null | head -500`);
      const lines = stdout.split('\n').filter(Boolean);
      const byFile = {}; for (const l of lines) { const f = l.split(':')[0]; byFile[f] = (byFile[f]||0)+1; }
      return { total: lines.length, byFile, lines: lines.slice(0, 100) };
    }

    // --- test-coverage ---
    if (action === 'test-coverage') {
      const { stdout: testStdout } = await execP(`find "${workspacePath}" -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | head -200`);
      const testFiles = testStdout.split('\n').filter(Boolean);
      const { stdout: srcStdout } = await execP(`find "${workspacePath}" -name "*.js" -not -name "*.test.*" -not -name "*.spec.*" -not -path "*/node_modules/*" 2>/dev/null | head -500`);
      const srcFiles = srcStdout.split('\n').filter(Boolean);
      return { ratio: srcFiles.length > 0 ? Math.round(testFiles.length / srcFiles.length * 100) : 0, testFiles: testFiles.length, sourceFiles: srcFiles.length };
    }

    // --- coupling ---
    if (action === 'coupling') {
      const commits = await gitService.getCommitHistory(workspacePath, null, Math.min(commitLimit, 200)).catch(() => []);
      const coupling = [];
      for (const c of commits.slice(0, 100)) {
        try { const diff = await gitService.getCommitDiff(workspacePath, c.hash); const files = diff.files.map(f => f.filePath).filter(f => includeFile(f)).sort(); for (let i = 0; i < files.length; i++) for (let j = i+1; j < files.length; j++) coupling.push({ file1:files[i], file2:files[j], commit:c.hash }); }
        catch {}
      }
      const cs = new Map();
      for (const e of coupling) { const k = `${e.file1}|${e.file2}`; cs.set(k, (cs.get(k)||0)+1); }
      const edges = Array.from(cs.entries()).map(([k,c]) => { const [f1,f2]=k.split('|'); return { file1:f1, file2:f2, coChangeCount:c, strength:(c/commits.length)*100 }; }).sort((a,b) => b.strength - a.strength).slice(0, 100);
      return { couplingEdges: edges, clusters: calcCouplingClusters(edges) };
    }

    throw new Error(`Unknown action: ${action}. Valid actions: analyze, find-hotspots, find-todos, test-coverage, coupling, report`);
  }
};
