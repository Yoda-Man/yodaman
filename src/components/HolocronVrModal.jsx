import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, SlidersHorizontal, Flame, X, ExternalLink, MessageSquare, Copy, Crosshair, Glasses, ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { api } from '../api/api'
import { arrangeConstellation } from '../holocron/forceLayout'
import { buildModel, visibleNodes, searchNodes, heatValues, timeAgo } from '../holocron/graphModel'
import { createConstellation } from '../holocron/scene'
// The bundled plugin manifest is the one version source; it was hardcoded
// here as v0.5.1 and drifted from every release after it.
import holocronManifest from '../../plugins/plugin.json'

const NODE_LIMITS = [500, 1500, 4000]
const DEFAULT_LIMIT = 1500
const glass = 'border border-white/10 bg-slate-950/70 shadow-2xl backdrop-blur-xl'

function Toggle({ label, checked, onChange, disabled, hint }) {
  return (
    <label className={`flex items-center justify-between gap-4 py-1.5 text-xs ${disabled ? 'opacity-40' : 'cursor-pointer'}`} title={hint}>
      <span className="text-slate-200">{label}</span>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-cyan-400' : 'bg-slate-700'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}

function Stat({ label, value }) {
  return <div className="flex items-baseline gap-1.5"><span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span><span className="text-xs font-bold text-slate-100">{value}</span></div>
}

/**
 * Holocron: the workspace as a navigable constellation.
 *
 * The scene lives in holocron/scene.js and the data rules in
 * holocron/graphModel.js; this component owns the chrome around them:
 * search, filters, the cluster legend, node detail, and VR.
 */
export default function HolocronVrModal({ project, diagnostics, onClose }) {
  const mountRef = useRef(null)
  const labelsRef = useRef(null)
  const sceneRef = useRef(null)
  const searchRef = useRef(null)

  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [model, setModel] = useState(null)
  const [layout, setLayout] = useState(null)
  const [status, setStatus] = useState('Mapping workspace constellation…')
  const [error, setError] = useState('')
  const [vrSupported, setVrSupported] = useState(false)
  const [session, setSession] = useState(null)
  const [focus, setFocus] = useState(null)
  const [hover, setHover] = useState(null)
  const [query, setQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState({ hideTests: false, hideDocs: false, hideThirdParty: true, languages: new Set(), recentOnly: false })
  const [heatOn, setHeatOn] = useState(false)
  const [heat, setHeat] = useState(null)
  const [preview, setPreview] = useState(null)

  // ── Load, lay out, and build the scene ───────────────────────────────
  useEffect(() => {
    let disposed = false
    async function start() {
      try {
        setStatus('Mapping workspace constellation…')
        const graph = await api.mapGraphify(project.path, limit, { rank: 'degree' })
        if (disposed) return
        const next = buildModel(graph)

        setStatus('Arranging constellation…')
        const groups = next.clusters.map((cluster) => [cluster.key, cluster.members])
        const nodeIndex = new Map(next.nodes.map((node) => [node.id, node.index]))
        const arranged = await arrangeConstellation({ nodes: next.nodes, links: graph.links || [], nodeIndex, groups })
        if (disposed) return
        if (arranged.engine === 'fallback' && next.nodes.length > 1) {
          // Degraded, not broken: worth knowing about, never worth failing over.
          console.warn(`[Holocron] basic layout: ${arranged.reason}`)
          api.reportClientError({ message: `Holocron layout engine unavailable: ${arranged.reason}`, userAction: 'holocron_layout', component: 'HolocronVrModal', severity: 'medium', context: { project: project.path, nodes: next.nodes.length } })
        }

        sceneRef.current = createConstellation({
          mount: mountRef.current,
          labelsLayer: labelsRef.current,
          model: next,
          positions: arranged.positions,
          onHover: (index, event) => setHover(index >= 0 && event ? { index, x: event.offsetX, y: event.offsetY } : null),
          onSelect: (index) => setFocus(index >= 0 ? index : null)
        })
        setModel(next)
        setLayout(arranged)
        setStatus('')
        const supported = Boolean(navigator.xr) && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)
        if (!disposed) setVrSupported(supported)
      } catch (err) {
        setError(`Could not start Holocron: ${err.message}`)
        api.reportClientError({ message: err.message, stack: err.stack, userAction: 'render_holocron_vr', component: 'HolocronVrModal', severity: 'high', context: { project: project.path, diagnostics } })
      }
    }
    setModel(null)
    setFocus(null)
    start()
    return () => {
      disposed = true
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [project.path, limit])

  // Recent changes for the heatmap; optional, since not every workspace is a git repo.
  useEffect(() => {
    let cancelled = false
    api.gitHeatmap(project.path).then((data) => { if (!cancelled) setHeat(data?.files || []) }).catch(() => { if (!cancelled) setHeat([]) })
    return () => { cancelled = true }
  }, [project.path])

  const heatInfo = useMemo(() => (model && heat ? heatValues(model, heat) : null), [model, heat])
  const hasHeat = Boolean(heatInfo?.heat.some((value) => value > 0))
  const visible = useMemo(() => (model ? visibleNodes(model, filters, heatInfo?.heat) : null), [model, filters, heatInfo])
  const shown = visible ? visible.reduce((sum, v) => sum + v, 0) : 0

  useEffect(() => { if (visible) sceneRef.current?.setVisible(visible) }, [visible])
  useEffect(() => { sceneRef.current?.setHeat(heatOn && hasHeat ? heatInfo.heat : null) }, [heatOn, hasHeat, heatInfo])
  useEffect(() => {
    sceneRef.current?.setFocus(focus)
    setPreview(null)
    const node = focus !== null ? model?.nodes[focus] : null
    if (!node?.file) return undefined
    let cancelled = false
    api.previewFile(project.path, node.file, node.line)
      .then((data) => { if (!cancelled) setPreview(data) })
      .catch((err) => { if (!cancelled) setPreview({ error: err.message }) })
    return () => { cancelled = true }
  }, [focus, model, project.path])

  const results = useMemo(() => (model ? searchNodes(model, query).filter((n) => visible?.[n.index]) : []), [model, query, visible])

  function select(index) {
    setFocus(index)
    sceneRef.current?.flyTo(index)
    setQuery('')
  }

  // ── Keyboard: / or ⌘K search, R reset, Esc clear ─────────────────────
  useEffect(() => {
    const onKey = (event) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === 'Escape') {
        if (query) setQuery('')
        else if (focus !== null) setFocus(null)
        else if (filtersOpen) setFiltersOpen(false)
      } else if (!typing && (event.key === 'r' || event.key === 'R')) {
        setFocus(null)
        sceneRef.current?.resetCamera()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [query, focus, filtersOpen])

  async function toggleVr() {
    try {
      if (session) {
        await session.end()
        return
      }
      setStatus('Requesting headset permission…')
      const next = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] })
      next.addEventListener('end', () => { setSession(null); setStatus('') })
      await sceneRef.current.renderer.xr.setSession(next)
      setSession(next)
      setStatus('Headset connected')
    } catch (err) {
      setError(`Headset connection failed: ${err.message}. Confirm the headset is awake, connected, and WebXR permission is allowed.`)
      api.reportClientError({ message: err.message, stack: err.stack, userAction: 'enter_immersive_vr', component: 'HolocronVrModal', severity: 'high', context: { project: project.path, diagnostics } })
    }
  }

  function askAgent(node) {
    const where = node.file ? ` (${node.file}${node.line ? `:${node.line}` : ''})` : ''
    window.dispatchEvent(new CustomEvent('yodaman:ask-agent', {
      detail: { project, prompt: `Explain ${node.label}${where}: what it does, what depends on it, and what would break if it changed.` }
    }))
    onClose()
  }

  const node = focus !== null && model ? model.nodes[focus] : null
  const hovered = hover && model ? model.nodes[hover.index] : null
  const toggleLanguage = (language) => setFilters((f) => {
    const languages = new Set(f.languages)
    if (languages.has(language)) languages.delete(language)
    else languages.add(language)
    return { ...f, languages }
  })
  const activeFilters = [filters.hideTests, filters.hideDocs, filters.hideThirdParty, filters.recentOnly].filter(Boolean).length + filters.languages.size

  return <div className="fixed inset-0 z-[100] flex flex-col bg-[#02030a] text-slate-100">
    {/* ── Top bar ── */}
    <header className="relative z-30 flex items-center gap-4 border-b border-white/5 bg-[#02030a]/80 px-5 py-2.5 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <div className="text-sm font-black tracking-tight">Holocron <span className="ml-1 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-cyan-200">v{holocronManifest.version}</span></div>
        <div className="flex items-center gap-1.5 truncate text-xs text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{project.name || project.path}</div>
      </div>
      {model ? <div className="hidden items-center gap-5 xl:flex">
        <Stat label="Nodes" value={model.nodes.length < model.totalNodes ? `${model.nodes.length.toLocaleString()} of ${model.totalNodes.toLocaleString()}` : model.nodes.length.toLocaleString()} />
        <Stat label="Edges" value={(model.edges.length / 2).toLocaleString()} />
        <Stat label="Clusters" value={model.clusters.length} />
        {layout ? <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${layout.engine === 'wasm' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/30 bg-amber-400/10 text-amber-200'}`} title={layout.engine === 'wasm' ? `Force-directed layout by the WASM engine in ${layout.ms} ms` : `Basic layout: ${layout.reason}`}>{layout.engine === 'wasm' ? 'Force layout' : 'Basic layout'}</span> : null}
      </div> : null}

      <div className="relative mx-auto w-full max-w-md">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) select(results[0].index) }}
          placeholder="Search files and symbols…" aria-label="Search the constellation"
          className="w-full rounded-lg border border-white/10 bg-white/[0.04] py-1.5 pl-8 pr-12 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-400/50 focus:outline-none" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-white/10 px-1 text-[9px] text-slate-500">⌘K</span>
        {query && <div className={`absolute left-0 right-0 top-full mt-1 overflow-hidden rounded-lg ${glass}`}>
          {results.length ? results.map((r) => (
            <button key={r.index} type="button" onClick={() => select(r.index)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: model.clusters[r.cluster].color }} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">{r.label}</span>
              <span className="truncate text-[10px] text-slate-500">{r.file}</span>
            </button>
          )) : <div className="px-3 py-2 text-xs text-slate-500">No match on screen</div>}
        </div>}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setFiltersOpen((o) => !o)} className={`relative rounded-lg border px-2.5 py-1.5 ${filtersOpen ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200' : 'border-white/10 text-slate-300 hover:bg-white/5'}`} title="Filters" aria-label="Filters">
          <SlidersHorizontal size={14} />
          {activeFilters ? <span className="absolute -right-1 -top-1 rounded-full bg-cyan-400 px-1 text-[9px] font-black text-slate-950">{activeFilters}</span> : null}
        </button>
        <button type="button" onClick={() => setHeatOn((on) => !on)} disabled={!hasHeat} className={`rounded-lg border px-2.5 py-1.5 disabled:opacity-30 ${heatOn ? 'border-amber-400/50 bg-amber-400/10 text-amber-200' : 'border-white/10 text-slate-300 hover:bg-white/5'}`} title={hasHeat ? 'Colour by changes in the last 30 days' : 'No git changes in the last 30 days'} aria-label="Change heatmap"><Flame size={14} /></button>
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-xs text-slate-300" aria-label="Maximum nodes" title="How many of the most connected nodes to show">
          {NODE_LIMITS.map((n) => <option key={n} value={n}>{n.toLocaleString()} nodes</option>)}
        </select>
        <button type="button" onClick={toggleVr} disabled={!vrSupported && !session} className="saber flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-black text-slate-950 disabled:bg-slate-800 disabled:text-slate-500" title={vrSupported ? 'Enter the constellation in a headset' : 'No WebXR headset detected'}><Glasses size={14} />{session ? 'Exit VR' : 'VR'}</button>
        <button type="button" onClick={onClose} className="rounded-lg border border-white/10 p-1.5 text-slate-300 hover:bg-white/10" aria-label="Close Holocron"><X size={16} /></button>
      </div>
    </header>
    {error ? <div className="relative z-30 border-b border-rose-400/30 bg-rose-500/10 px-5 py-2 text-sm text-rose-100">{error}</div> : null}

    {/* ── Constellation ── */}
    <div ref={mountRef} className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" />
      {status ? <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"><div className={`rounded-xl px-5 py-3 text-sm text-cyan-100 ${glass}`} role="status">{status}</div></div> : null}

      {hovered && hover.index !== focus ? <div className={`pointer-events-none absolute z-20 rounded-lg px-3 py-2 ${glass}`} style={{ left: hover.x + 14, top: hover.y + 14 }}>
        <div className="text-xs font-bold text-white">{hovered.label}</div>
        <div className="text-[10px] text-slate-400">{hovered.language} · {hovered.degree} connections{heatInfo?.changes[hovered.index] ? ` · changed ${timeAgo(heatInfo.changes[hovered.index].last)}` : ''}</div>
      </div> : null}

      {/* Cluster legend */}
      {model ? <div className={`absolute left-4 top-4 z-20 w-60 rounded-xl p-3 ${glass}`}>
        <div className="mb-2 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.2em] text-slate-400"><span>Clusters</span><span className="tracking-normal text-slate-500">{shown.toLocaleString()} of {model.nodes.length.toLocaleString()} shown</span></div>
        <div className="space-y-0.5">{model.clusters.filter((c) => visible?.[c.hub]).slice(0, 9).map((c) => (
          <button key={c.key} type="button" onClick={() => select(c.hub)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] text-slate-300 hover:bg-white/5" title={`Fly to ${c.name}`}>
            <span className="h-2 w-2 shrink-0 rounded-full shadow-[0_0_8px_currentColor]" style={{ background: c.color, color: c.color }} />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="text-slate-500">{c.members.length}</span>
          </button>
        ))}</div>
        {heatOn && hasHeat ? <div className="mt-3 border-t border-white/10 pt-2"><div className="mb-1 text-[9px] uppercase tracking-widest text-slate-500">Changes, last 30 days</div><div className="h-1.5 rounded-full bg-gradient-to-r from-blue-900 via-amber-500 to-red-500" /></div> : null}
      </div> : null}

      {/* Filters */}
      {filtersOpen && model ? <div className={`absolute right-4 top-4 z-30 w-72 rounded-xl p-4 ${glass}`}>
        <div className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Visibility</div>
        <Toggle label="Hide tests" checked={filters.hideTests} onChange={(v) => setFilters((f) => ({ ...f, hideTests: v }))} />
        <Toggle label="Hide docs" checked={filters.hideDocs} onChange={(v) => setFilters((f) => ({ ...f, hideDocs: v }))} />
        <Toggle label="Hide third-party" checked={filters.hideThirdParty} onChange={(v) => setFilters((f) => ({ ...f, hideThirdParty: v }))} />
        <Toggle label="Recent changes only" checked={filters.recentOnly} disabled={!hasHeat} hint={hasHeat ? 'Files changed in the last 30 days' : 'No git changes in the last 30 days'} onChange={(v) => setFilters((f) => ({ ...f, recentOnly: v }))} />
        <div className="mb-2 mt-3 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Language</div>
        <div className="flex flex-wrap gap-1.5">{model.languages.slice(0, 12).map(({ language, count }) => (
          <button key={language} type="button" onClick={() => toggleLanguage(language)} className={`rounded-md border px-2 py-1 text-[10px] ${filters.languages.has(language) ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-100' : 'border-white/10 text-slate-300 hover:bg-white/5'}`}>{language} <span className="text-slate-500">{count}</span></button>
        ))}</div>
        <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-2 text-[11px] text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />Showing {shown.toLocaleString()} of {model.nodes.length.toLocaleString()}</div>
      </div> : null}

      {/* Node detail */}
      {node ? <aside className={`absolute bottom-4 right-4 top-4 z-20 flex w-[380px] flex-col overflow-hidden rounded-xl ${glass}`} style={{ borderColor: `${model.clusters[node.cluster].color}55` }}>
        <div className="border-b border-white/10 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full shadow-[0_0_12px_currentColor]" style={{ background: model.clusters[node.cluster].color, color: model.clusters[node.cluster].color }} />
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-base font-black text-white">{node.label}</h2>
              {node.file ? <button type="button" onClick={() => navigator.clipboard?.writeText(node.file)} className="mt-0.5 flex max-w-full items-center gap-1 text-left text-[11px] text-slate-400 hover:text-slate-200" title="Copy path"><span className="truncate">{node.file}{node.line ? `:${node.line}` : ''}</span><Copy size={11} className="shrink-0" /></button> : null}
            </div>
            <button type="button" onClick={() => setFocus(null)} className="text-slate-500 hover:text-white" aria-label="Close details"><X size={16} /></button>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {[['Links', node.degree], ['Uses', model.outgoing[node.index].length], ['Used by', model.incoming[node.index].length], ['Changes', heatInfo?.changes[node.index]?.count ?? 0]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-white/[0.04] px-1 py-1.5"><div className="text-sm font-black text-white">{v}</div><div className="text-[9px] uppercase tracking-widest text-slate-500">{k}</div></div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded-md bg-cyan-400/10 px-2 py-0.5 text-cyan-200">{node.language}</span>
            <span className="rounded-md bg-white/5 px-2 py-0.5 text-slate-300">{node.kind}</span>
            <span className="rounded-md bg-white/5 px-2 py-0.5 text-slate-300">{model.clusters[node.cluster].name}</span>
            {heatInfo?.changes[node.index] ? <span className="rounded-md bg-amber-400/10 px-2 py-0.5 text-amber-200">changed {timeAgo(heatInfo.changes[node.index].last)}</span> : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => askAgent(node)} className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 py-2 text-xs font-bold hover:bg-white/5"><MessageSquare size={13} />Ask Agent</button>
            <button type="button" disabled={!node.file} onClick={() => api.openInEditor(project.path, node.file, node.line).catch((err) => setError(`Could not open ${node.file}: ${err.message}`))} className="flex items-center justify-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-400/10 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-40"><ExternalLink size={13} />Open in editor</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {[['Uses', model.outgoing[node.index], ArrowUpRight], ['Used by', model.incoming[node.index], ArrowDownLeft]].map(([title, list, Icon]) => list.length ? (
            <div key={title}>
              <div className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">{title} ({list.length})</div>
              {list.slice(0, 8).map((i) => (
                <button key={i} type="button" onClick={() => select(i)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-white/5">
                  <Icon size={11} className="shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{model.nodes[i].label}</span>
                  <span className="max-w-[45%] truncate text-[10px] text-slate-500">{model.nodes[i].file}</span>
                </button>
              ))}
              {list.length > 8 ? <div className="px-1 text-[10px] text-slate-500">+ {list.length - 8} more</div> : null}
            </div>
          ) : null)}
          {node.file ? <div>
            <div className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Code</div>
            {preview?.lines ? <pre className="overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-4 text-slate-300">{preview.lines.map((text, i) => <div key={i} className="flex gap-3"><span className="w-8 shrink-0 select-none text-right text-slate-600">{preview.startLine + i}</span><span className="whitespace-pre">{text}</span></div>)}</pre>
              : <div className="text-[11px] text-slate-500">{preview?.error ? `No preview: ${preview.error}` : 'Loading…'}</div>}
          </div> : null}
        </div>
      </aside> : null}

      {/* Controls */}
      <div className={`pointer-events-none absolute bottom-4 left-4 z-20 rounded-xl px-3 py-2 text-[10px] text-slate-400 ${glass}`}>
        <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
          <span className="text-slate-200">Drag</span><span>orbit</span>
          <span className="text-slate-200">Right-drag</span><span>pan</span>
          <span className="text-slate-200">Scroll</span><span>zoom</span>
          <span className="text-slate-200">Click</span><span>inspect</span>
          <span className="text-slate-200">/ or ⌘K</span><span>search</span>
          <span className="text-slate-200">R</span><span>reset camera</span>
        </div>
      </div>
      <button type="button" onClick={() => { setFocus(null); sceneRef.current?.resetCamera() }} className={`absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-slate-300 hover:text-white ${glass}`}><Crosshair size={12} />Reset view</button>
    </div>
  </div>
}
