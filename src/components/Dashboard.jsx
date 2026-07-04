import { useEffect, useState } from 'react'
import { Database, Cpu, Shield, Activity, Package, Server, RefreshCw, Link, ClipboardList, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { api } from '../api/api'
import HealthDashboard from './HealthDashboard'
import useHealthCheck from '../hooks/useHealthCheck'

function CtxConfigPanel() {
    const [cfg, setCfg] = useState(null)
    const [editing, setEditing] = useState(null)
    const [editValue, setEditValue] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => { fetch('/api/ctx/config').then(r => r.json()).then(d => { if (d.ok) setCfg(d.config) }).catch(() => {}) }, [])

    const startEdit = (key, val) => {
        setEditing(key)
        setEditValue(String(val ?? ''))
    }

    const saveEdit = async () => {
        if (!editing || saving) return
        setSaving(true)
        try {
            const r = await fetch('/api/ctx/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: editing, value: editValue })
            })
            const d = await r.json()
            if (d.ok) {
                setCfg(prev => ({ ...prev, [editing]: editValue }))
                setEditing(null)
            }
        } catch (_) { }
        setSaving(false)
    }

    if (!cfg) return null

    const sections = [
        { label: 'Model', keys: ['default_model', 'default_provider'] },
        { label: 'Embedding', keys: ['embedding.provider', 'embedding.model', 'embedding.fallback_provider', 'embedding.fallback_model', 'embedding.batch_size', 'embedding.timeout_ms'] },
        { label: 'Search', keys: ['search.top_k', 'search.rerank'] },
        { label: 'Observability', keys: ['observability.enabled', 'observability.sample_rate', 'observability.langfuse_host'] },
        { label: 'Evaluation', keys: ['eval.default_k', 'eval.python_path', 'eval.ragas_model'] },
    ]

    return (
        <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2.5 bg-violet-500/10 border border-violet-500/20 rounded-xl">
                    <Server size={20} className="text-violet-400" />
                </div>
                <div className="flex-1">
                    <h3 className="font-bold text-slate-300 uppercase tracking-widest text-xs">ctx Configuration</h3>
                    <p className="text-[10px] text-slate-500">Click any value to edit</p>
                </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {sections.map(s => (
                    <div key={s.label} className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-1.5">
                        <div className="text-[10px] text-slate-500 font-black uppercase tracking-wider">{s.label}</div>
                        {s.keys.map(k => {
                            const val = cfg[k]
                            const isEditing = editing === k
                            const shortKey = k.split('.').pop()
                            return (
                                <div key={k} className="flex items-center justify-between group">
                                    <span className="text-[10px] text-slate-500 truncate mr-2">{shortKey}</span>
                                    {isEditing ? (
                                        <div className="flex items-center gap-1">
                                            <input
                                                autoFocus
                                                type="text"
                                                value={editValue}
                                                onChange={e => setEditValue(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null) }}
                                                className="w-20 bg-slate-800 border border-indigo-500/50 rounded px-1.5 py-0.5 text-[10px] text-slate-200 outline-none"
                                            />
                                            <button onClick={saveEdit} disabled={saving} className="text-emerald-400 text-[10px] font-bold">✓</button>
                                            <button onClick={() => setEditing(null)} className="text-slate-500 text-[10px]">✗</button>
                                        </div>
                                    ) : (
                                        <span
                                            className="text-[10px] text-slate-300 font-mono truncate cursor-pointer hover:text-indigo-400 max-w-[80px]"
                                            title={`${k} = ${val}`}
                                            onClick={() => startEdit(k, val)}
                                        >
                                            {typeof val === 'boolean' ? (val ? '✓' : '✗') : String(val ?? '—')}
                                        </span>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ))}
            </div>
        </div>
    )
}

function HealthPill({ checks }) {
    if (!checks) {
        return (
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-500/10 border border-slate-500/20 rounded-xl">
                <Activity size={16} className="text-slate-400 animate-pulse" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Checking...</span>
            </div>
        )
    }

    const entries = Object.values(checks).filter(Boolean)
    const allOk = entries.length > 0 && entries.every(c => c.ok === true)
    const anyFail = entries.some(c => c.ok === false)

    if (allOk) {
        return (
            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <CheckCircle size={16} className="text-emerald-400" />
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">System Optimal</span>
            </div>
        )
    }

    if (anyFail) {
        const failed = entries.filter(c => !c.ok)
        return (
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl" title={failed.map(f => f.message).join('; ')}>
                <AlertTriangle size={16} className="text-amber-400" />
                <span className="text-xs font-bold text-amber-400 uppercase tracking-widest">Degraded</span>
            </div>
        )
    }

    return (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-500/10 border border-slate-500/20 rounded-xl">
            <Activity size={16} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Unknown</span>
        </div>
    )
}

export default function Dashboard() {
    const [status, setStatus] = useState(null)
    const [diagnostics, setDiagnostics] = useState(null)
    const [pairing, setPairing] = useState(null)
    const [projects, setProjects] = useState([])
    const [loading, setLoading] = useState(true)
    const { checks } = useHealthCheck()

    useEffect(() => {
        fetchStatus()
    }, [])

    const fetchStatus = async () => {
        try {
            // Try primary status endpoint first
            const data = await api.getStatus()
            // Show "Ollama" label not the raw version string
            if (data.llm?.provider === 'ollama') {
                data.llm.model = data.llm.model || 'Ollama'
            }
            setStatus({ ...data, ctxInstalled: true })
        } catch (_) {
            // Status endpoint may fail if ctx is unresponsive;
            // health endpoint is the reliable fallback.
            try {
                const healthRes = await fetch('/api/health')
                const healthData = await healthRes.json()
                setStatus({
                    version: healthData.checks?.ctx?.ok ? 'ctx-active' : 'ctx-unavailable',
                    ctxInstalled: healthData.checks?.ctx?.ok === true,
                    ctxVersion: healthData.checks?.ctx?.version || null,
                    nodeVersion: healthData.checks?.node?.message || 'unknown',
                    platform: healthData.platform?.arch || 'unknown',
                    llm: healthData.checks?.ollama?.ok
                        ? { model: 'Ollama', provider: 'ollama', details: healthData.checks.ollama.version || '' }
                        : { model: 'n/a', provider: 'none' },
                    database: {
                        sizeFormatted: healthData.memory ? `${(healthData.memory.rss / 1024 / 1024).toFixed(0)} MB` : '—',
                        path: '—'
                    },
                    totalChunks: 0,
                    projects: healthData.projects?.total || 0,
                    embedding: { provider: '—', model: '—' }
                })
            } catch (_) {
                console.error('Failed to fetch status via health endpoint')
            }
        }

        try {
            setDiagnostics(await api.getDesktopDiagnostics())
        } catch (_) {
            // Non-critical
        }

        try {
            const projRes = await fetch('/api/projects')
            const projData = await projRes.json()
            if (Array.isArray(projData)) setProjects(projData)
        } catch (_) {
            // Non-critical
        } finally {
            setLoading(false)
        }
    }

    const createPairing = async () => {
        try {
            setPairing(await api.createPairing(window.location.origin))
        } catch (err) {
            console.error('Failed to create pairing link:', err)
        }
    }

    if (loading) return (
        <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <div className="h-12 w-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
                <p className="text-slate-500 font-bold uppercase tracking-[0.2em] text-[10px]">Analyzing System...</p>
            </div>
        </div>
    )

    if (!status) return (
        <div className="flex-1 flex items-center justify-center text-rose-400 font-bold">
            FAILED TO RETRIEVE SYSTEM DATA
        </div>
    )

    return (
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <header className="flex justify-between items-end">
                    <div>
                        <h1 className="text-3xl font-outfit font-black text-slate-100 tracking-tight">System Dashboard</h1>
                        <p className="text-slate-500 font-medium mt-1">Real-time metrics from YodaMan Core</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={fetchStatus} className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-bold text-slate-300 uppercase tracking-widest hover:text-white hover:bg-white/10">
                            <RefreshCw size={16} />
                            Refresh
                        </button>
                        <button onClick={createPairing} className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-xs font-bold text-indigo-300 uppercase tracking-widest hover:bg-indigo-500/20">
                            <Link size={16} />
                            Pair Mobile
                        </button>
                        <HealthPill checks={checks} />
                    </div>
                </header>

                {pairing ? (
                    <div className="glass-panel p-5 space-y-2">
                        <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Mobile Pairing Link</div>
                        <div className="text-sm text-slate-200 font-mono break-all">{pairing.link}</div>
                    </div>
                ) : null}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Database Stats */}
                    <div className="glass-panel p-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                                <Database size={20} className="text-blue-400" />
                            </div>
                            <h3 className="font-bold text-slate-300 uppercase tracking-widest text-xs">Vector Storage</h3>
                        </div>
                        <div>
                            <div className="text-4xl font-outfit font-black text-white">{status.database?.sizeFormatted || '0 MB'}</div>
                            <p className="text-slate-500 text-[10px] uppercase font-black tracking-widest mt-1">Total DB Size</p>
                        </div>
                        <div className="pt-4 border-t border-white/5 flex justify-between items-center">
                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Path</span>
                            <div className="flex items-center gap-2 max-w-full">
                              <span className="text-[10px] text-slate-400 font-mono truncate flex-1 min-w-0" title={status.database?.path}>{status.database?.path}</span>
                              <button onClick={()=>navigator.clipboard.writeText(status.database?.path||'')} className="shrink-0 p-1 rounded hover:bg-white/10 text-slate-500 hover:text-slate-200 transition-colors" title="Copy path"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                            </div>
                        </div>
                    </div>

                    {/* AI Model Stats + Context Expert Status */}
                    <div className="glass-panel p-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                                <Cpu size={20} className="text-purple-400" />
                            </div>
                            <h3 className="font-bold text-slate-300 uppercase tracking-widest text-xs">AI Engine</h3>
                        </div>
                        <div>
                            <div className="text-2xl font-outfit font-black text-white truncate" title={status.llm?.model}>{status.llm?.model}</div>
                            <p className="text-slate-500 text-[10px] uppercase font-black tracking-widest mt-1">Active LLM Model</p>
                        </div>
                        <div className="pt-4 border-t border-white/5 flex justify-between items-center">
                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Provider</span>
                            <span className="text-[10px] text-slate-400 font-mono uppercase">{status.llm?.provider}</span>
                        </div>
                        <div className="pt-4 border-t border-white/5 flex justify-between items-center">
                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Context Expert</span>
                            <span className="text-[10px] font-mono font-bold uppercase">
                                {status.ctxInstalled ? `✓ ${status.ctxVersion || ''}` : '✓ Checking...'}
                            </span>
                        </div>
                    </div>

                    {/* Index Stats */}
                    <div className="glass-panel p-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                                <Package size={20} className="text-emerald-400" />
                            </div>
                            <h3 className="font-bold text-slate-300 uppercase tracking-widest text-xs">Indexing</h3>
                        </div>
                        <div>
                            <div className="text-4xl font-outfit font-black text-white">{status.totalChunks?.toLocaleString()}</div>
                            <p className="text-slate-500 text-[10px] uppercase font-black tracking-widest mt-1">Total Chunks Indexed</p>
                        </div>
                        <div className="pt-4 border-t border-white/5 flex justify-between items-center">
                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Projects</span>
                            <span className="text-[10px] text-slate-400 font-mono">{status.projects} Active</span>
                        </div>
                    </div>
                </div>

                {projects.length > 0 && (
                    <div className="glass-panel p-6 space-y-3">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2.5 bg-teal-500/10 border border-teal-500/20 rounded-xl">
                                <Server size={20} className="text-teal-400" />
                            </div>
                            <h3 className="font-bold text-slate-300 uppercase tracking-widest text-xs">Workspaces ({projects.length})</h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {projects.slice(0, 6).map((p, i) => (
                                <div key={i} className="bg-white/5 p-3 rounded-xl border border-white/5 flex items-center gap-3">
                                    <div className={`w-2 h-2 rounded-full ${p.indexed ? 'bg-emerald-500' : 'bg-slate-500'}`} title={p.indexed ? 'Indexed' : 'Pending'} />
                                    <div className="min-w-0">
                                        <div className="text-xs font-bold text-slate-200 truncate" title={p.name}>{p.name}</div>
                                        <div className="text-[10px] text-slate-500 truncate" title={p.path}>{p.path.replace(/^\/Users\/[^/]+/, '~').replace(/.*\/Documents/, '~/Documents')}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ctx Configuration */}
                <CtxConfigPanel />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Embedding Config */}
                    <div className="glass-panel p-8 space-y-6">
                        <div className="flex items-center gap-4">
                            <div className="h-10 w-10 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center">
                                <Shield size={20} className="text-amber-400" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-100 tracking-tight">Embedding Configuration</h3>
                                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Knowledge Base Vectorizer</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Provider</div>
                                <div className="text-sm font-bold text-slate-200 capitalize">{status.embedding?.provider}</div>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Model</div>
                                <div className="text-sm font-bold text-slate-200 truncate" title={status.embedding?.model}>{status.embedding?.model?.split('/').pop()}</div>
                            </div>
                        </div>
                    </div>

                    {/* Environment Info */}
                    <div className="glass-panel p-8 space-y-6">
                        <div className="flex items-center gap-4">
                            <div className="h-10 w-10 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center">
                                <Server size={20} className="text-indigo-400" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-100 tracking-tight">Environment</h3>
                                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Runtime Information</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">OS Platform</div>
                                <div className="text-sm font-bold text-slate-200 capitalize">{status.platform}</div>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Node Version</div>
                                <div className="text-sm font-bold text-slate-200">{status.nodeVersion}</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* System Health — reusable HealthDashboard component */}
                <div className="glass-panel p-8 space-y-6">
                    <div className="flex items-center gap-4">
                        <div className="h-10 w-10 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl flex items-center justify-center">
                            <ClipboardList size={20} className="text-cyan-300" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-slate-100 tracking-tight">System Health</h3>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Dependency status &amp; runtime diagnostics</p>
                        </div>
                    </div>
                    <HealthDashboard />
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                            <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">PID</div>
                            <div className="text-sm font-bold text-slate-200">{diagnostics?.runtime?.pid || '...'}</div>
                        </div>
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                            <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Uptime</div>
                            <div className="text-sm font-bold text-slate-200">{diagnostics?.runtime?.uptimeSeconds || 0}s</div>
                        </div>
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                            <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Tasks</div>
                            <div className="text-sm font-bold text-slate-200">{diagnostics?.tasks?.total || 0}</div>
                        </div>
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                            <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Approvals</div>
                            <div className="text-sm font-bold text-slate-200">{diagnostics?.tasks?.pendingApprovals || 0}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
