import { useEffect, useState } from 'react'
import { GitBranch, GitCommit, GitPullRequest, ArrowUp, ArrowDown, Plus, RefreshCw, Check } from 'lucide-react'

export default function GitPanel({ projects = [] }) {
    const [selected, setSelected] = useState('')
    const [git, setGit] = useState(null)
    const [loading, setLoading] = useState(false)
    const [commitMsg, setCommitMsg] = useState('')
    const [newBranch, setNewBranch] = useState('')
    const [actionStatus, setActionStatus] = useState('')

    const fetchGit = async (path) => {
        if (!path) return
        setLoading(true)
        try {
            const r = await fetch(`/api/git/context?path=${encodeURIComponent(path)}`)
            setGit(await r.json())
        } catch (_) { setGit(null) }
        setLoading(false)
    }

    useEffect(() => {
        if (projects.length > 0 && !selected) setSelected(projects[0].path)
    }, [projects])

    useEffect(() => {
        if (selected) fetchGit(selected)
    }, [selected])

    const doAction = async (endpoint, body = {}) => {
        setActionStatus('...')
        try {
            const r = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: selected, ...body })
            })
            const d = await r.json()
            setActionStatus(d.ok ? '✓ Done' : '✗ ' + (d.error || 'failed'))
            if (d.ok) fetchGit(selected)
        } catch (e) {
            setActionStatus('✗ ' + e.message)
        }
        setTimeout(() => setActionStatus(''), 3000)
    }

    if (projects.length === 0) return null

    return (
        <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2.5 bg-orange-500/10 border border-orange-500/20 rounded-xl">
                    <GitBranch size={20} className="text-orange-400" />
                </div>
                <div className="flex-1">
                    <h3 className="font-bold text-slate-300 uppercase tracking-widest text-xs">Git Integration</h3>
                </div>
                {projects.length > 1 && (
                    <select
                        value={selected}
                        onChange={e => setSelected(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none"
                    >
                        {projects.map(p => (
                            <option key={p.path} value={p.path}>{p.name}</option>
                        ))}
                    </select>
                )}
            </div>

            {loading && <p className="text-xs text-slate-500">Loading git status...</p>}

            {git && !loading && (
                <div className="space-y-3">
                    {/* Branch info */}
                    <div className="flex items-center gap-3 bg-white/5 rounded-xl p-3 border border-white/5">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">Branch</span>
                        <span className="text-xs font-bold text-slate-200 font-mono">{git.branch}</span>
                        {git.ahead > 0 && (
                            <span className="flex items-center gap-1 text-[10px] text-amber-400 font-bold">
                                <ArrowUp size={10} /> {git.ahead}
                            </span>
                        )}
                        {git.behind > 0 && (
                            <span className="flex items-center gap-1 text-[10px] text-sky-400 font-bold">
                                <ArrowDown size={10} /> {git.behind}
                            </span>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2">
                        <button onClick={() => doAction('/api/git/commit', { message: commitMsg || 'yodaman update' })}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-[10px] font-bold text-emerald-400 uppercase hover:bg-emerald-500/20">
                            <GitCommit size={12} /> Commit
                        </button>
                        <button onClick={() => doAction('/api/git/push')}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500/10 border border-sky-500/20 rounded-lg text-[10px] font-bold text-sky-400 uppercase hover:bg-sky-500/20">
                            <ArrowUp size={12} /> Push
                        </button>
                        <button onClick={() => doAction('/api/git/pull')}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[10px] font-bold text-amber-400 uppercase hover:bg-amber-500/20">
                            <GitPullRequest size={12} /> Pull
                        </button>
                    </div>

                    {/* Commit message */}
                    <input
                        placeholder="Commit message..."
                        value={commitMsg}
                        onChange={e => setCommitMsg(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] text-slate-200 outline-none focus:border-indigo-500/50"
                    />

                    {/* New branch */}
                    <div className="flex items-center gap-2">
                        <input
                            placeholder="New branch name..."
                            value={newBranch}
                            onChange={e => setNewBranch(e.target.value)}
                            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] text-slate-200 outline-none focus:border-indigo-500/50"
                        />
                        <button onClick={() => { doAction('/api/git/branch', { branch: newBranch }); setNewBranch('') }}
                            disabled={!newBranch}
                            className="flex items-center gap-1 px-3 py-1.5 bg-violet-500/10 border border-violet-500/20 rounded-lg text-[10px] font-bold text-violet-400 uppercase disabled:opacity-30 hover:bg-violet-500/20">
                            <Plus size={12} /> Branch
                        </button>
                    </div>

                    {/* Recent commits */}
                    {git.recentCommits?.length > 0 && (
                        <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                            {git.recentCommits.map((c, i) => (
                                <div key={i} className="flex items-center gap-2 text-[10px]">
                                    <span className="text-indigo-400 font-mono">{c.hash}</span>
                                    <span className="text-slate-300 truncate flex-1">{c.subject}</span>
                                    <span className="text-slate-600 shrink-0">{c.relativeTime}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Status */}
                    {actionStatus && (
                        <p className={`text-[10px] font-bold ${actionStatus.startsWith('✓') ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {actionStatus}
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
