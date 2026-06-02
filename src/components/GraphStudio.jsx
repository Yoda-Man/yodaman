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
      if (line.startsWith('- ')) return <p key={index} className="ml-4 text-sm leading-7 text-slate-300">- {line.slice(2)}</p>
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
  }, [mode, selectedProject?.path, report])

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
  const graphReady = Boolean(status?.graphExists)
  const activeArtifactExists = Boolean(status?.artifacts?.[mode]?.exists)
  const artifactModeLabel = mode === 'mindmap' ? 'mind map' : 'canvas visualization'
  const hasAnyFullArtifact = Boolean(status?.artifacts?.mindmap?.exists || status?.artifacts?.visualizer?.exists)

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
    <div className="grid h-full grid-cols-[260px_minmax(0,1fr)_340px] bg-[#020617] text-slate-200">
      <aside className="border-r border-white/10 bg-slate-950/80 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
            <GitBranch size={22} className="text-cyan-300" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-black text-white">Graph Studio</h1>
            <p className="break-words text-[10px] font-mono leading-4 text-slate-500" title={selectedProject.path}>{selectedProject.name}</p>
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
              <div className={graphReady ? 'text-emerald-300' : 'text-amber-300'}>{graphReady ? 'Graph ready' : 'Needs build'}</div>
              {status?.stale ? <div className="text-rose-300">Graph stale</div> : null}
              {graphReady && !hasAnyFullArtifact ? <div className="text-amber-300">Full HTML viz unavailable</div> : null}
              <div className="text-slate-500">{graphMap ? `${graphMap.totalNodes} nodes / ${graphMap.totalLinks} links` : 'No map loaded'}</div>
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={loadGraphStudio} disabled={busy || loading} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-40" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button onClick={buildGraph} disabled={busy} className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-3 text-xs font-black uppercase tracking-widest text-slate-950 hover:bg-cyan-300 disabled:opacity-40">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {busy ? 'Building...' : 'Build'}
          </button>
        </div>

        {error ? <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs leading-5 text-rose-200">{error}</div> : null}
      </aside>

      <main className="relative min-w-0 overflow-hidden">
        {(mode === 'mindmap' || mode === 'visualizer') ? (
          graphReady && activeArtifactExists ? (
            <iframe
              key={`${mode}-${selectedProject.path}`}
              title={`Graphify ${mode}`}
              src={artifactUrl}
              sandbox="allow-scripts allow-same-origin"
              className="h-full w-full border-0 bg-slate-950"
            />
          ) : !graphReady ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <AlertTriangle className="mx-auto mb-4 text-amber-300" size={44} />
                <h2 className="text-2xl font-black text-white">Build the graph to begin</h2>
                <p className="mt-2 text-sm text-slate-400">Graphify has not generated a visualization for this workspace yet.</p>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div className="max-w-xl">
                <AlertTriangle className="mx-auto mb-4 text-amber-300" size={44} />
                <h2 className="text-2xl font-black text-white">Full {artifactModeLabel} unavailable</h2>
                <p className="mt-2 text-sm leading-7 text-slate-400">
                  The Graphify graph was built, but this workspace is too large for the generated HTML visualization. Use Map Preview for a compact architecture view or Report for the full markdown summary.
                </p>
                <div className="mt-6 flex justify-center gap-3">
                  <button onClick={() => setMode('preview')} className="rounded-xl bg-cyan-500 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-950 hover:bg-cyan-300">
                    Map Preview
                  </button>
                  <button onClick={() => setMode('report')} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-200 hover:bg-white/10">
                    Report
                  </button>
                </div>
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
