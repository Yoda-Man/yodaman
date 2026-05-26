import { useEffect, useMemo, useState } from 'react'
import { Clipboard, RefreshCw, X, Terminal } from 'lucide-react'
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

    const loadLogs = async () => {
        setLoading(true)
        try {
            setPayload(await api.getLogs(300))
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

                    <pre className="min-h-[360px] whitespace-pre-wrap rounded-2xl border border-white/5 bg-black/40 p-5 text-[11px] leading-6 text-slate-300 font-mono">
                        {text || (loading ? 'Loading logs...' : 'No logs captured yet.')}
                    </pre>
                </div>
            </div>
        </div>
    )
}
