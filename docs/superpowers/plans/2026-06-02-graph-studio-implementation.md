# Graph Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first shippable Graph Studio experience: a project-scoped Graph tab that embeds Graphify's generated visualizations, renders the report, and exposes native query/rebuild/impact controls.

**Architecture:** The backend serves only known Graphify artifacts from registered workspaces through controlled `/api/graphify/*` routes. The frontend adds a dedicated `GraphStudio` component that lazy-loads one sandboxed iframe at a time and uses the existing Graphify APIs for status, map, query, build, and impact analysis. The Plugins screen is trimmed back to plugin administration so Graphify feels like a core product surface.

**Tech Stack:** Node.js, Express, Jest, React 18, Vite, Tailwind CSS, Lucide React, generated Graphify HTML, sandboxed iframes.

---

## File Structure

- Modify `backend/infrastructure/GraphifyService.js`: add artifact path metadata, report filename fallback, artifact existence checks, and safe report reading.
- Modify `backend/interfaces/RestController.js`: add artifact and report routes after existing graph status/build routes; apply route-specific iframe CSP headers.
- Modify `tests/interfaces/RestController.test.js`: add route tests for artifact serving, type rejection, missing artifacts, report fetching, and unregistered workspace rejection.
- Modify `src/api/api.js`: add helpers for artifact URLs and report fetching.
- Modify `src/App.jsx`: add the `Graph` tab and pass `selectedProject` into `GraphStudio`.
- Create `src/components/GraphStudio.jsx`: dedicated Graph Studio UI, iframe modes, report mode, map preview, query, rebuild, and impact panel.
- Modify `src/components/PluginsWindow.jsx`: remove the large Graphify management surface while keeping plugin marketplace behavior intact.
- Modify `shared/yodamanClient.js` and `shared/yodamanClient.d.ts`: expose report and artifact helpers for other clients.
- Modify `docs/api.md`, `README.md`, and `user_manual.md`: document Graph Studio and the new routes.

---

### Task 1: Backend Artifact Metadata

**Files:**
- Modify: `backend/infrastructure/GraphifyService.js`
- Test: `tests/interfaces/RestController.test.js`

- [ ] **Step 1: Write failing tests for artifact route behavior**

Append these imports and helpers near the top of `tests/interfaces/RestController.test.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
```

Update the `res` object inside `invoke()` to include `sendFile`:

```js
sendFile: jest.fn(function sendFile(filePath) {
    this.filePath = filePath;
    return this;
})
```

Append these tests inside the existing `describe` block:

```js
describe('Graphify artifact routes', () => {
    let workspace;
    let originalConfig;

    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-graph-studio-'));
        fs.mkdirSync(path.join(workspace, 'graphify-out'), { recursive: true });
        originalConfig = fs.existsSync('config.json')
            ? fs.readFileSync('config.json', 'utf8')
            : undefined;
        fs.writeFileSync('config.json', JSON.stringify({
            watchedDirectories: [workspace],
            removedDirectories: []
        }, null, 2));
        router.loadConfig();
    });

    afterEach(() => {
        if (originalConfig === undefined) {
            fs.rmSync('config.json', { force: true });
        } else {
            fs.writeFileSync('config.json', originalConfig);
        }
        router.loadConfig();
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    test('GET /graphify/artifact serves a known generated artifact', async () => {
        const artifactPath = path.join(workspace, 'graphify-out', 'graph.html');
        fs.writeFileSync(artifactPath, '<html><body>graph</body></html>');

        const response = await invoke('get', '/graphify/artifact', {
            query: { path: workspace, type: 'mindmap' }
        });

        expect(response.statusCode).toBe(200);
        expect(response.filePath).toBe(artifactPath);
        expect(response.headers['Content-Security-Policy']).toContain("'unsafe-inline'");
    });

    test('GET /graphify/artifact rejects unknown artifact types', async () => {
        const response = await invoke('get', '/graphify/artifact', {
            query: { path: workspace, type: 'passwd' }
        });

        expect(response.statusCode).toBe(400);
        expect(response.payload).toEqual(expect.objectContaining({
            code: 'invalid_graphify_artifact'
        }));
    });

    test('GET /graphify/artifact reports missing generated artifacts', async () => {
        const response = await invoke('get', '/graphify/artifact', {
            query: { path: workspace, type: 'visualizer' }
        });

        expect(response.statusCode).toBe(404);
        expect(response.payload).toEqual(expect.objectContaining({
            code: 'graphify_artifact_missing'
        }));
    });

    test('GET /graphify/report returns markdown report text', async () => {
        fs.writeFileSync(path.join(workspace, 'graphify-out', 'graph_report.md'), '# Report\n\nHello graph.');

        const response = await invoke('get', '/graphify/report', {
            query: { path: workspace }
        });

        expect(response.statusCode).toBe(200);
        expect(response.payload).toEqual({
            path: workspace,
            report: '# Report\n\nHello graph.',
            reportPath: path.join(workspace, 'graphify-out', 'graph_report.md')
        });
    });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test -- tests/interfaces/RestController.test.js`

Expected: FAIL because `/graphify/artifact`, `/graphify/report`, `router.loadConfig`, and artifact helpers are not implemented.

- [ ] **Step 3: Add artifact helpers to GraphifyService**

In `backend/infrastructure/GraphifyService.js`, add these constants after `CLOUD_MODEL_KEYS`:

```js
const ARTIFACTS = {
    mindmap: 'graph.html',
    visualizer: 'graph_visualizer.html'
};
const REPORT_FILENAMES = ['graph_report.md', 'GRAPH_REPORT.md'];
```

Add these helpers near `reportPath(projectPath)`:

```js
function graphifyOutPath(projectPath) {
    return path.join(projectPath, 'graphify-out');
}

function artifactPath(projectPath, type) {
    const filename = ARTIFACTS[type];
    if (!filename) {
        const err = new Error(`Unknown Graphify artifact type: ${type}`);
        err.status = 400;
        err.code = 'invalid_graphify_artifact';
        throw err;
    }
    return path.join(graphifyOutPath(projectPath), filename);
}

function existingReportPath(projectPath) {
    const found = REPORT_FILENAMES
        .map(filename => path.join(graphifyOutPath(projectPath), filename))
        .find(candidate => fs.existsSync(candidate));
    return found || path.join(graphifyOutPath(projectPath), REPORT_FILENAMES[0]);
}
```

Change `reportPath(projectPath)` to:

```js
function reportPath(projectPath) {
    return existingReportPath(projectPath);
}
```

Add these exports inside `module.exports`:

```js
artifactPath,
artifactTypes: () => Object.keys(ARTIFACTS),
```

Add these methods before `readReport(projectPath, ...)`:

```js
artifact(projectPath, type) {
    const currentArtifactPath = artifactPath(projectPath, type);
    if (!fs.existsSync(currentArtifactPath)) {
        const err = new Error(`Graphify artifact not found: ${currentArtifactPath}`);
        err.status = 404;
        err.code = 'graphify_artifact_missing';
        throw err;
    }
    return {
        type,
        artifactPath: currentArtifactPath,
        filename: path.basename(currentArtifactPath)
    };
},
```

Update `status(projectPath)` so `currentReportPath` uses `reportPath(projectPath)`, then add artifact metadata to the returned object:

```js
artifacts: Object.fromEntries(Object.keys(ARTIFACTS).map(type => {
    const currentArtifactPath = artifactPath(projectPath, type);
    const exists = fs.existsSync(currentArtifactPath);
    const stat = exists ? fs.statSync(currentArtifactPath) : null;
    return [type, {
        path: currentArtifactPath,
        exists,
        updatedAt: stat?.mtime?.toISOString()
    }];
}))
```

- [ ] **Step 4: Run tests to confirm route failures remain**

Run: `npm run test -- tests/interfaces/RestController.test.js`

Expected: FAIL only for missing `/graphify/artifact`, `/graphify/report`, and `router.loadConfig` route behavior.

- [ ] **Step 5: Commit backend helper work**

```bash
git add backend/infrastructure/GraphifyService.js tests/interfaces/RestController.test.js
git commit -m "test: cover graphify artifact routes"
```

---

### Task 2: Backend Artifact Routes

**Files:**
- Modify: `backend/interfaces/RestController.js`
- Modify: `tests/interfaces/RestController.test.js`

- [ ] **Step 1: Expose config reload for route tests**

Near the existing `let config = ...` declaration in `backend/interfaces/RestController.js`, add:

```js
function loadConfig() {
    config = { watchedDirectories: [], removedDirectories: [] };
    if (fs.existsSync(CONFIG_PATH)) {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
    config.watchedDirectories = Array.isArray(config.watchedDirectories) ? config.watchedDirectories : [];
    config.removedDirectories = Array.isArray(config.removedDirectories) ? config.removedDirectories : [];
    return config;
}
```

Replace any existing inline config load at module setup with:

```js
loadConfig();
```

At the bottom before `module.exports = router`, attach:

```js
router.loadConfig = loadConfig;
```

- [ ] **Step 2: Add Graphify artifact CSP helper**

Add this helper near `jsonError`:

```js
function setGraphifyArtifactHeaders(res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self' data: blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' http://localhost:* http://127.0.0.1:*"
    );
}
```

- [ ] **Step 3: Add artifact and report routes**

Add these routes after `/graphify/build` and before `/graphify/query`:

```js
router.get('/graphify/artifact', (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.query.path);
        const type = validateString(req.query.type, 'type', { max: 100 });
        const artifact = graphifyService.artifact(dirPath, type);
        setGraphifyArtifactHeaders(res);
        res.sendFile(artifact.artifactPath);
    } catch (err) {
        logger.error('graphify_artifact_request_failed', err, { requestId: req.id, path: dirPath });
        jsonError(res, err.status || 500, err.message, err.code || 'graphify_artifact_failed');
    }
});

router.get('/graphify/report', (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.query.path);
        const report = graphifyService.readReport(dirPath, { maxChars: 120000 });
        if (!report) {
            return jsonError(res, 404, `Graphify report not found: ${graphifyService.reportPath(dirPath)}`, 'graphify_report_missing');
        }
        res.json({
            path: dirPath,
            report,
            reportPath: graphifyService.reportPath(dirPath)
        });
    } catch (err) {
        logger.error('graphify_report_request_failed', err, { requestId: req.id, path: dirPath });
        jsonError(res, err.status || 500, err.message, err.code || 'graphify_report_failed');
    }
});
```

- [ ] **Step 4: Run backend tests**

Run: `npm run test -- tests/interfaces/RestController.test.js`

Expected: PASS.

- [ ] **Step 5: Commit artifact routes**

```bash
git add backend/interfaces/RestController.js tests/interfaces/RestController.test.js
git commit -m "feat: serve graphify visualization artifacts"
```

---

### Task 3: Frontend API Helpers

**Files:**
- Modify: `src/api/api.js`
- Modify: `shared/yodamanClient.js`
- Modify: `shared/yodamanClient.d.ts`

- [ ] **Step 1: Add browser API helpers**

In `src/api/api.js`, add these methods after `buildGraphify(path)`:

```js
graphifyArtifactUrl(path, type) {
    const url = new URL(`${API_BASE}/graphify/artifact`, window.location.origin);
    url.searchParams.append('path', path);
    url.searchParams.append('type', type);
    return url.toString();
},

async getGraphifyReport(path) {
    return request(`${API_BASE}/graphify/report?path=${encodeURIComponent(path)}`);
},
```

- [ ] **Step 2: Add shared client helpers**

In `shared/yodamanClient.js`, add these methods near the other Graphify helpers:

```js
graphifyArtifact(path, type) {
    const params = new URLSearchParams({ path, type });
    return request(`/api/graphify/artifact?${params.toString()}`);
},
graphifyReport(path) {
    return request(`/api/graphify/report?path=${encodeURIComponent(path)}`);
},
```

In `shared/yodamanClient.d.ts`, add:

```ts
  graphifyArtifact(path: string, type: string): Promise<unknown>;
  graphifyReport(path: string): Promise<{ path: string; report: string; reportPath: string }>;
```

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Commit API helpers**

```bash
git add src/api/api.js shared/yodamanClient.js shared/yodamanClient.d.ts
git commit -m "feat: add graph studio api helpers"
```

---

### Task 4: Graph Studio Component

**Files:**
- Create: `src/components/GraphStudio.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Add the Graph tab to App**

In `src/App.jsx`, import:

```js
import GraphStudio from './components/GraphStudio'
import { MessageSquare, Search, LayoutDashboard, Book, Puzzle, Settings, Terminal, GitBranch } from 'lucide-react'
```

Add a new tab button between Search and Dashboard:

```jsx
<button 
  onClick={() => setActiveTab('graph')}
  className={`flex items-center gap-2 px-6 py-2 rounded-t-2xl border-t border-x border-white/5 transition-all font-bold text-xs uppercase tracking-widest ${activeTab === 'graph' ? 'bg-white/[0.03] text-cyan-300 border-cyan-500/30' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.01]'}`}
>
  <GitBranch size={14} />
  Graph
</button>
```

Add the render branch:

```jsx
{activeTab === 'graph' && <GraphStudio selectedProject={selectedProject} />}
```

- [ ] **Step 2: Create GraphStudio.jsx**

Create `src/components/GraphStudio.jsx` with:

```jsx
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileText, GitBranch, Loader2, Play, RefreshCw, Search, Zap } from 'lucide-react'
import { api } from '../api/api'

const MODES = [
  { id: 'mindmap', label: 'Mind Map' },
  { id: 'visualizer', label: 'Canvas' },
  { id: 'report', label: 'Report' },
  { id: 'preview', label: 'Map Preview' }
]

function markdownToBlocks(markdown) {
  return String(markdown || '')
    .split('\n')
    .map((line, index) => {
      if (line.startsWith('# ')) return <h1 key={index} className="mt-6 text-3xl font-black text-white first:mt-0">{line.slice(2)}</h1>
      if (line.startsWith('## ')) return <h2 key={index} className="mt-5 text-xl font-bold text-cyan-100">{line.slice(3)}</h2>
      if (line.startsWith('### ')) return <h3 key={index} className="mt-4 text-base font-bold text-slate-100">{line.slice(4)}</h3>
      if (line.startsWith('- ')) return <p key={index} className="ml-4 text-sm leading-7 text-slate-300">• {line.slice(2)}</p>
      if (!line.trim()) return <div key={index} className="h-3" />
      return <p key={index} className="text-sm leading-7 text-slate-300">{line}</p>
    })
}

export default function GraphStudio({ selectedProject }) {
  const [mode, setMode] = useState('mindmap')
  const [status, setStatus] = useState(null)
  const [graphMap, setGraphMap] = useState(null)
  const [report, setReport] = useState('')
  const [query, setQuery] = useState('')
  const [queryResult, setQueryResult] = useState('')
  const [impactNode, setImpactNode] = useState('')
  const [impactResult, setImpactResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const artifactUrl = useMemo(() => {
    if (!selectedProject?.path || mode === 'report' || mode === 'preview') return ''
    return api.graphifyArtifactUrl(selectedProject.path, mode)
  }, [selectedProject?.path, mode])

  useEffect(() => {
    loadGraphStudio()
  }, [selectedProject?.path])

  useEffect(() => {
    if (mode === 'report' && selectedProject?.path && !report) {
      loadReport()
    }
  }, [mode, selectedProject?.path])

  async function loadGraphStudio() {
    setError('')
    setQueryResult('')
    setImpactResult('')
    if (!selectedProject?.path) {
      setStatus(null)
      setGraphMap(null)
      setReport('')
      return
    }
    setLoading(true)
    try {
      const [nextStatus, nextMap] = await Promise.all([
        api.getGraphifyStatus(selectedProject.path),
        api.mapGraphify(selectedProject.path, 90).catch(() => null)
      ])
      setStatus(nextStatus)
      setGraphMap(nextMap)
      setReport('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function buildGraph() {
    if (!selectedProject?.path || busy) return
    setBusy(true)
    setError('')
    try {
      await api.buildGraphify(selectedProject.path)
      await loadGraphStudio()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function loadReport() {
    if (!selectedProject?.path) return
    setBusy(true)
    setError('')
    try {
      const data = await api.getGraphifyReport(selectedProject.path)
      setReport(data.report || '')
    } catch (err) {
      setError(err.message)
      setReport('')
    } finally {
      setBusy(false)
    }
  }

  async function queryGraph() {
    if (!selectedProject?.path || !query.trim() || busy) return
    setBusy(true)
    setQueryResult('')
    try {
      const data = await api.queryGraphify(selectedProject.path, query.trim())
      setQueryResult(data.insights || '')
    } catch (err) {
      setQueryResult(`Graph query failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function analyzeImpact() {
    if (!selectedProject?.path || !impactNode.trim() || busy) return
    setBusy(true)
    setImpactResult('')
    try {
      const data = await api.affectedGraphify(selectedProject.path, impactNode.trim(), 3)
      setImpactResult(data.impact || '')
    } catch (err) {
      setImpactResult(`Impact analysis failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  const positionedNodes = (graphMap?.nodes || []).map((node, index, list) => {
    const angle = (Math.PI * 2 * index) / Math.max(list.length, 1)
    const radius = 150 + ((node.community || 0) % 4) * 22
    return {
      ...node,
      x: 260 + Math.cos(angle) * radius,
      y: 210 + Math.sin(angle) * radius
    }
  })
  const positionById = Object.fromEntries(positionedNodes.map(node => [node.id, node]))

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center bg-[#020617] p-8">
        <div className="max-w-lg text-center">
          <GitBranch className="mx-auto mb-5 text-cyan-300" size={48} />
          <h1 className="text-4xl font-black tracking-tight text-white">Graph Studio</h1>
          <p className="mt-3 text-sm leading-7 text-slate-400">Select a workspace to reveal its Graphify knowledge graph.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid h-full grid-cols-[260px_1fr_340px] bg-[#020617] text-slate-200">
      <aside className="border-r border-white/10 bg-slate-950/80 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
            <GitBranch size={22} className="text-cyan-300" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black text-white">Graph Studio</h1>
            <p className="truncate text-[10px] font-mono text-slate-500" title={selectedProject.path}>{selectedProject.name}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-2">
          {MODES.map(item => (
            <button
              key={item.id}
              onClick={() => setMode(item.id)}
              className={`rounded-xl px-3 py-2 text-left text-xs font-black uppercase tracking-widest transition-all ${mode === item.id ? 'bg-cyan-500 text-slate-950' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Graph State</div>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading</div>
          ) : (
            <div className="space-y-2 text-xs">
              <div className={status?.graphExists ? 'text-emerald-300' : 'text-amber-300'}>{status?.graphExists ? 'Graph ready' : 'Needs build'}</div>
              {status?.stale ? <div className="text-rose-300">Graph stale</div> : null}
              <div className="text-slate-500">{graphMap ? `${graphMap.totalNodes} nodes / ${graphMap.totalLinks} links` : 'No map loaded'}</div>
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={loadGraphStudio} disabled={busy || loading} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-40" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button onClick={buildGraph} disabled={busy} className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-3 text-xs font-black uppercase tracking-widest text-slate-950 hover:bg-cyan-300 disabled:opacity-40">
            <Play size={15} />
            Build
          </button>
        </div>

        {error ? <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs leading-5 text-rose-200">{error}</div> : null}
      </aside>

      <main className="relative min-w-0 overflow-hidden">
        {(mode === 'mindmap' || mode === 'visualizer') ? (
          status?.graphExists ? (
            <iframe
              key={`${mode}-${selectedProject.path}`}
              title={`Graphify ${mode}`}
              src={artifactUrl}
              sandbox="allow-scripts allow-same-origin"
              className="h-full w-full border-0 bg-slate-950"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <AlertTriangle className="mx-auto mb-4 text-amber-300" size={44} />
                <h2 className="text-2xl font-black text-white">Build the graph to begin</h2>
                <p className="mt-2 text-sm text-slate-400">Graphify has not generated a visualization for this workspace yet.</p>
              </div>
            </div>
          )
        ) : null}

        {mode === 'report' ? (
          <div className="h-full overflow-y-auto p-8 custom-scrollbar">
            <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-slate-950/70 p-8">
              {busy && !report ? <div className="text-sm text-slate-400">Loading report...</div> : markdownToBlocks(report || 'No Graphify report is available for this workspace.')}
            </div>
          </div>
        ) : null}

        {mode === 'preview' ? (
          <div className="h-full p-8">
            <svg viewBox="0 0 520 420" className="h-full w-full rounded-2xl border border-white/10 bg-slate-950/80">
              {(graphMap?.links || []).slice(0, 140).map((link, index) => {
                const source = positionById[link.source]
                const target = positionById[link.target]
                if (!source || !target) return null
                return <line key={`${link.source}-${link.target}-${index}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="rgba(103,232,249,0.16)" strokeWidth="1" />
              })}
              {positionedNodes.map(node => (
                <g key={node.id}>
                  <circle cx={node.x} cy={node.y} r={node.fileType === 'code' ? 6 : 5} fill={node.fileType === 'code' ? '#22d3ee' : '#a78bfa'} opacity="0.9" />
                  <title>{node.label}</title>
                </g>
              ))}
            </svg>
          </div>
        ) : null}
      </main>

      <aside className="overflow-y-auto border-l border-white/10 bg-slate-950/80 p-5 custom-scrollbar">
        <div className="mb-5 flex items-center gap-2">
          <Zap size={18} className="text-cyan-300" />
          <h2 className="font-bold text-white">Graph Actions</h2>
        </div>

        <div className="space-y-3">
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && queryGraph()} placeholder="Ask about architecture, flow, coupling..." className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500/40" />
          <button onClick={queryGraph} disabled={!query.trim() || busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-950 hover:bg-cyan-300 disabled:opacity-40">
            <Search size={15} />
            Query Graph
          </button>
          {queryResult ? <pre className="max-h-64 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-6 text-slate-300 custom-scrollbar">{queryResult}</pre> : null}
        </div>

        <div className="mt-6 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <AlertTriangle size={16} className="text-amber-300" />
            Impact Lens
          </div>
          <input value={impactNode} onChange={e => setImpactNode(e.target.value)} onKeyDown={e => e.key === 'Enter' && analyzeImpact()} placeholder="Function, file, class, concept..." className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-amber-500/40" />
          <button onClick={analyzeImpact} disabled={!impactNode.trim() || busy} className="w-full rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-black uppercase tracking-widest text-amber-200 hover:bg-amber-500/20 disabled:opacity-40">
            Analyze Impact
          </button>
          {impactResult ? <pre className="max-h-64 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-6 text-slate-300 custom-scrollbar">{impactResult}</pre> : null}
        </div>

        <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
            <FileText size={16} className="text-slate-300" />
            Top Nodes
          </div>
          <div className="space-y-2">
            {(graphMap?.nodes || []).slice(0, 12).map(node => (
              <button key={node.id} onClick={() => setImpactNode(node.label || node.id)} className="block w-full rounded-lg border border-white/5 bg-white/[0.03] p-2 text-left hover:bg-white/[0.06]">
                <div className="truncate text-xs font-bold text-slate-200">{node.label}</div>
                <div className="truncate text-[10px] font-mono text-slate-500">{node.sourceFile || node.fileType || 'graph node'}</div>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  )
}
```

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS. If Tailwind emits long-class warnings, the build still succeeds.

- [ ] **Step 4: Commit Graph Studio UI**

```bash
git add src/App.jsx src/components/GraphStudio.jsx
git commit -m "feat: add graph studio tab"
```

---

### Task 5: Plugin Screen Cleanup

**Files:**
- Modify: `src/components/PluginsWindow.jsx`

- [ ] **Step 1: Remove Graphify-heavy state and actions from PluginsWindow**

In `src/components/PluginsWindow.jsx`, remove these state variables:

```js
const [graphStatus, setGraphStatus] = useState(null);
const [graphQuery, setGraphQuery] = useState('');
const [graphResult, setGraphResult] = useState('');
const [impactNode, setImpactNode] = useState('');
const [impactResult, setImpactResult] = useState('');
const [graphMap, setGraphMap] = useState(null);
const [isGraphBusy, setIsGraphBusy] = useState(false);
```

Remove `loadGraphStatus`, `buildGraph`, `queryGraph`, `analyzeImpact`, `positionedNodes`, and `positionById`.

Remove the large `<section>` whose heading is `Graphify Knowledge Graph`.

- [ ] **Step 2: Add a lightweight Graphify handoff card**

Add this small section where the large Graphify section used to be:

```jsx
<section className="mb-10 rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] p-5">
  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
    <div className="flex items-start gap-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
        <GitBranch size={22} className="text-cyan-300" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-white">Graphify is now in Graph Studio</h2>
        <p className="mt-1 text-sm text-slate-500">Use the Graph tab for visual exploration, report reading, graph queries, and impact analysis.</p>
      </div>
    </div>
    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-cyan-300">
      Required Graph Layer
    </div>
  </div>
</section>
```

Update the Lucide import to remove unused graph action icons and keep only icons that still render.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS with no unused import errors.

- [ ] **Step 4: Commit cleanup**

```bash
git add src/components/PluginsWindow.jsx
git commit -m "refactor: move graphify controls to graph studio"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/api.md`
- Modify: `README.md`
- Modify: `user_manual.md`

- [ ] **Step 1: Update API docs**

In `docs/api.md`, add after the Graphify build section:

```md
### `GET /graphify/artifact`

Serves a generated Graphify HTML artifact for a registered workspace. Query parameters:

- `path`: absolute registered workspace path.
- `type`: `mindmap` for `graph.html` or `visualizer` for `graph_visualizer.html`.

The route only serves known Graphify artifacts from the workspace's `graphify-out/` directory.

### `GET /graphify/report`

Returns the Graphify markdown report for a registered workspace.
```

- [ ] **Step 2: Update product docs**

In `README.md`, update the paragraph that mentions the Plugins tab to:

```md
Graphify is wired into YodaMan as a required knowledge layer. Reindexing a workspace updates both the Context Expert index and the Graphify graph, then adds the project graph to Graphify's global graph. Chat and agent answers receive graph report context plus question-specific graph traversal output; stale graphs rebuild before answer context is gathered. The Graph tab opens Graph Studio, a dedicated project-scoped surface for interactive Graphify visualizations, graph reports, graph queries, and impact analysis. Runtime clients can also call `/api/graphify/status`, `/api/graphify/build`, `/api/graphify/artifact`, `/api/graphify/report`, `/api/graphify/query`, `/api/graphify/explain`, `/api/graphify/path`, `/api/graphify/affected`, `/api/graphify/map`, and `/api/graphify/tree`.
```

In `user_manual.md`, update the "Graphify knowledge graph" section to include:

```md
The Graph tab opens Graph Studio, a project-scoped visual workspace for Graphify outputs. Graph Studio embeds the generated mind-map and Vis.js canvas artifacts, shows graph freshness, renders the markdown report, and keeps graph query plus impact analysis actions close to the visualization.
```

- [ ] **Step 3: Commit docs**

```bash
git add docs/api.md README.md user_manual.md
git commit -m "docs: document graph studio routes"
```

---

### Task 7: Final Verification

**Files:**
- No code edits expected.

- [ ] **Step 1: Run focused backend tests**

Run: `npm run test -- tests/interfaces/RestController.test.js`

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm run test`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: PASS and `dist/` generated.

- [ ] **Step 4: Manual browser verification**

Run: `npm run dev`

Expected: local runtime starts. Open the app, select a workspace, and verify:

- The top navigation includes `Graph`.
- Without a selected project, Graph Studio shows the select-workspace empty state.
- With a selected project, Graph Studio shows graph status and mode buttons.
- `Mind Map` and `Canvas` load one iframe at a time.
- `Report` loads markdown text from `/api/graphify/report`.
- `Map Preview` shows the compact native graph when `/api/graphify/map` returns nodes.
- Query and Impact actions display results without leaving Graph Studio.
- Plugins no longer presents Graphify as the main plugin marketplace feature.

- [ ] **Step 5: Commit any verification fixes**

If fixes were needed:

```bash
git add <fixed-files>
git commit -m "fix: polish graph studio integration"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- First-class Graph tab: Task 4.
- Sandboxed generated artifacts: Tasks 1, 2, and 4.
- Native query/rebuild/impact/report controls: Tasks 3 and 4.
- Plugin screen cleanup: Task 5.
- Safe artifact serving and CSP guardrails: Tasks 1 and 2.
- Client/shared helpers: Task 3.
- Documentation and verification: Tasks 6 and 7.

No placeholders remain. Function names and route paths are consistent across backend, API helpers, and UI tasks.
