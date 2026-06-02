import { useEffect, useMemo, useState } from 'react'
import { Clipboard, RefreshCw, X, Terminal, Search } from 'lucide-react'
import { api } from '../api/api'

function formatLog(entry) {
    const meta = { ...entry }
    delete meta.timestamp
    delete meta.level
    delete meta.message
    const detail = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
    return `[${entry.timestamp}] ${entry.level?.toUpperCase()} ${entry.message}${detail}`
}

export default function LogsModal({ onClose }) {
    const [payload, setPayload] = useState({ logs: [], queue: null })
    const [loading, setLoading] = useState(true)
    const [copied, setCopied] = useState(false)
    const [filters, setFilters] = useState({
        query: '',
        level: '',
        severity: '',
        userAction: ''
    })

    const loadLogs = async () => {
        setLoading(true)
        try {
            setPayload(await api.getLogs(300, filters))
        } catch (err) {
            setPayload({
                logs: [{
                    timestamp: new Date().toISOString(),
                    level: 'error',
                    message: 'failed_to_load_logs',
                    error: err.message
                }],
                queue: null
            })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadLogs()
    }, [])

    const text = useMemo(() => {
        const queue = payload.queue ? `Queue: ${JSON.stringify(payload.queue, null, 2)}\n\n` : ''
        return `${queue}${(payload.logs || []).map(formatLog).join('\n')}`
    }, [payload])

    const copyLogs = async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
    }

    return (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-md flex items-center justify-center z-[110] p-6 animate-in fade-in duration-300">
            <div className="bg-slate-900/95 border border-white/10 rounded-[24px] shadow-[0_0_100px_rgba(0,0,0,0.55)] w-full max-w-5xl max-h-[82vh] overflow-hidden flex flex-col">
                <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                            <Terminal size={20} className="text-cyan-300" />
                        </div>
                        <div>
                            <h2 className="text-lg font-outfit font-bold text-slate-100 tracking-tight">Runtime Logs</h2>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Recent requests, queue events, and ctx index output</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={loadLogs} className="btn-secondary px-4" disabled={loading}>
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            <span>Refresh</span>
                        </button>
                        <button onClick={copyLogs} className="btn-secondary px-4" disabled={!text}>
                            <Clipboard size={16} />
                            <span>{copied ? 'Copied' : 'Copy'}</span>
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-xl transition-all group border border-transparent hover:border-white/10">
                            <X size={20} className="text-slate-500 group-hover:text-white" />
                        </button>
                    </div>
                </div>

                <div className="p-6 overflow-y-auto custom-scrollbar">
                    <div className="mb-5 grid grid-cols-1 lg:grid-cols-[1fr_150px_150px_180px] gap-3">
                        <label className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                value={filters.query}
                                onChange={(e) => setFilters(prev => ({ ...prev, query: e.target.value }))}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') loadLogs()
                                }}
                                placeholder="Search logs, stack traces, requests..."
                                className="w-full rounded-xl border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-sm text-slate-200 outline-none focus:border-cyan-500/40"
                            />
                        </label>
                        <select
                            value={filters.level}
                            onChange={(e) => setFilters(prev => ({ ...prev, level: e.target.value }))}
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-200 outline-none focus:border-cyan-500/40"
                        >
                            <option value="">All levels</option>
                            <option value="error">Errors</option>
                            <option value="warn">Warnings</option>
                            <option value="info">Info</option>
                        </select>
                        <select
                            value={filters.severity}
                            onChange={(e) => setFilters(prev => ({ ...prev, severity: e.target.value }))}
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-200 outline-none focus:border-cyan-500/40"
                        >
                            <option value="">All severity</option>
                            <option value="critical">Critical</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                        </select>
                        <select
                            value={filters.userAction}
                            onChange={(e) => setFilters(prev => ({ ...prev, userAction: e.target.value }))}
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-200 outline-none focus:border-cyan-500/40"
                        >
                            <option value="">All actions</option>
                            <option value="code_search">Code search</option>
                            <option value="agent_tool_call">Agent tool call</option>
                            <option value="chat_ask">Chat ask</option>
                            <option value="startup">Startup</option>
                        </select>
                    </div>

                    {payload.queue && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
                                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Indexing</div>
                                <div className="text-sm font-bold text-slate-200 mt-1">{payload.queue.isProcessing ? 'Running' : 'Idle'}</div>
                            </div>
                            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
                                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Queued</div>
                                <div className="text-sm font-bold text-slate-200 mt-1">{payload.queue.queue?.length || 0}</div>
                            </div>
                            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
                                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Active PID</div>
                                <div className="text-sm font-bold text-slate-200 mt-1">{payload.queue.active?.pid || 'None'}</div>
                            </div>
                        </div>
                    )}

                    <div className="mb-3 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-500">
                        <span>{payload.logs?.length || 0} matching log entries</span>
                        <button onClick={loadLogs} className="text-cyan-300 hover:text-cyan-200">
                            Apply Filters
                        </button>
                    </div>

                    <pre className="min-h-[360px] whitespace-pre-wrap rounded-2xl border border-white/5 bg-black/40 p-5 text-[11px] leading-6 text-slate-300 font-mono">
                        {text || (loading ? 'Loading logs...' : 'No logs captured yet.')}
                    </pre>
                </div>
            </div>
        </div>
    )
}
