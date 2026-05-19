import { useEffect, useState } from 'react'
import { Database, Cpu, Shield, Activity, Package, Server, RefreshCw, Link, ClipboardList } from 'lucide-react'
import { api } from '../api/api'

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
            const data = await api.getStatus()
            setStatus(data)
            setDiagnostics(await api.getDesktopDiagnostics())
        } catch (err) {
            console.error('Failed to fetch status:', err)
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
                            <span className="text-[10px] text-slate-400 font-mono truncate max-w-[150px]">{status.database?.path}</span>
                        </div>
                    </div>

                    {/* AI Model Stats */}
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

                <div className="glass-panel p-8 space-y-6">
                    <div className="flex items-center gap-4">
                        <div className="h-10 w-10 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl flex items-center justify-center">
                            <ClipboardList size={20} className="text-cyan-300" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-100 tracking-tight">Runtime Diagnostics</h3>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Desktop and task state</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
