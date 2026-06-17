import { useEffect, useState } from 'react'
import { Database, Cpu, Shield, Activity, Package, Server, RefreshCw, Link, ClipboardList } from 'lucide-react'
import { api } from '../api/api'
import HealthDashboard from './HealthDashboard'

export default function Dashboard() {
    const [status, setStatus] = useState(null)
    const [diagnostics, setDiagnostics] = useState(null)
    const [pairing, setPairing] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchStatus()
    }, [])

    const fetchStatus = async () => {
        try {
            // Try primary status endpoint first
            const data = await api.getStatus()
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
                        ? { model: healthData.checks.ollama.version || 'ollama', provider: 'ollama' }
                        : { model: 'n/a', provider: 'none' },
                    database: { sizeFormatted: '—', path: '—' },
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
                        <div className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                            <Activity size={16} className="text-indigo-400" />
                            <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">System Optimal</span>
                        </div>
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
