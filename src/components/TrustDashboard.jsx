/**
 * TrustDashboard — unified health across Context Expert, Graphify, and OpenSpec.
 *
 * Shows per-workspace freshness for all three tools in a visual dashboard,
 * plus the combined WorkspaceReadiness verdict. Makes "one honest trust signal"
 * tangible with per-tool breakdown.
 */

import React, { useState, useEffect } from 'react';
import { Shield, Activity, Database, GitBranch, FileText, RefreshCw, CheckCircle2, AlertTriangle, Clock, XCircle } from 'lucide-react';

function statusIcon(state) {
    switch (state) {
        case 'ready': return { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };
        case 'stale': return { icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
        case 'building': return { icon: RefreshCw, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' };
        case 'unindexed': return { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' };
        default: return { icon: AlertTriangle, color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' };
    }
}

export default function TrustDashboard({ projectRoot }) {
    const [health, setHealth] = useState(null);
    const [readiness, setReadiness] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!projectRoot) { setLoading(false); return; }
        Promise.all([
            fetch(`/api/health`).then(r => r.json()).catch(() => null),
            fetch(`/api/readiness?projectId=${encodeURIComponent(projectRoot)}`).then(r => r.json()).catch(() => null),
        ]).then(([h, r]) => {
            setHealth(h);
            setReadiness(r);
        }).finally(() => setLoading(false));
    }, [projectRoot]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-48">
                <div className="animate-spin h-5 w-5 border-2 border-indigo-400 border-t-transparent rounded-full" />
            </div>
        );
    }

    // Derive per-tool status
    const ctxStatus = readiness?.state || (health?.checks?.ctx?.ok ? 'ready' : 'unindexed');
    const graphStatus = readiness?.graphState || (health?.checks?.graphify?.ok ? 'ready' : 'unindexed');
    const specStatus = health?.checks?.openspec?.ok ? (readiness?.specState || 'ready') : 'unindexed';

    const tools = [
        {
            name: 'Context Expert',
            icon: Database,
            status: ctxStatus,
            version: health?.checks?.ctx?.version,
            detail: readiness?.state === 'ready' ? 'Index is current' : readiness?.state === 'stale' ? 'Index is stale' : 'Not yet indexed',
            desc: 'Semantic code search and indexing',
        },
        {
            name: 'Graphify',
            icon: GitBranch,
            status: graphStatus,
            version: health?.checks?.graphify?.version,
            detail: readiness?.graphState === 'current' ? 'Graph is current' : readiness?.graphState === 'stale' ? 'Graph is stale' : 'No graph built',
            desc: 'Knowledge graph for structural queries',
        },
        {
            name: 'OpenSpec',
            icon: FileText,
            status: specStatus,
            version: health?.checks?.openspec?.version,
            detail: health?.checks?.openspec?.ok ? 'CLI installed and reachable' : 'Not installed',
            desc: 'Spec-driven architecture intent',
        },
    ];

    const overallStatus = readiness?.overall || (health?.status === 'ok' && readiness?.ready ? 'ready' : 'degraded');
    const overall = statusIcon(overallStatus);
    const OverallIcon = overall.icon;

    return (
        <div className="space-y-4">
            {/* Overall verdict */}
            <div className={`rounded-2xl border ${overall.border} ${overall.bg} p-5`}>
                <div className="flex items-center gap-3">
                    <div className={`inline-flex items-center justify-center h-12 w-12 rounded-xl ${overall.bg} border ${overall.border}`}>
                        <OverallIcon size={24} className={overall.color} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white capitalize">{overallStatus}</h3>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                            {readiness?.reason || 'Health check complete'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Per-tool cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {tools.map(tool => {
                    const s = statusIcon(tool.status);
                    const Icon = s.icon;
                    return (
                        <div key={tool.name} className={`rounded-2xl border ${s.border} ${s.bg} p-4`}>
                            <div className="flex items-center gap-2 mb-3">
                                <tool.icon size={14} className={s.color} />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">{tool.name}</span>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                                <Icon size={18} className={s.color} />
                                <span className={`text-xs font-bold capitalize ${s.color}`}>{tool.status}</span>
                            </div>
                            <p className="text-[10px] text-slate-500 mb-1">{tool.detail}</p>
                            {tool.version && (
                                <div className="text-[9px] font-mono text-slate-600 mt-2">v{tool.version}</div>
                            )}
                            <div className="mt-3 pt-2 border-t border-white/[0.03]">
                                <div className="text-[9px] text-slate-600">{tool.desc}</div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Degraded / pending details */}
            {health?.degraded?.length > 0 && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle size={13} className="text-red-400" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">Degraded</span>
                    </div>
                    <div className="space-y-1">
                        {health.degraded.map((d, i) => (
                            <div key={i} className="text-[10px] text-red-300 font-mono">{d}</div>
                        ))}
                    </div>
                </div>
            )}

            {health?.pending?.length > 0 && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock size={13} className="text-amber-400" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Pending</span>
                    </div>
                    <div className="space-y-1">
                        {health.pending.map((p, i) => (
                            <div key={i} className="text-[10px] text-amber-300 font-mono">{p}</div>
                        ))}
                    </div>
                </div>
            )}

            {/* Explanation */}
            <div className="rounded-xl border border-white/5 bg-black/25 p-4">
                <div className="flex items-center gap-2 mb-2">
                    <Shield size={13} className="text-slate-400" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">How trust works</span>
                </div>
                <div className="text-[10px] text-slate-500 space-y-1">
                    <p><b className="text-slate-400">Weakest layer wins.</b> The overall verdict is always the worst of the three tools — a stale graph drags the whole workspace down, never hidden behind an average.</p>
                    <p><b className="text-slate-400">Post-write refresh.</b> After an agent task modifies files, touched workspaces are reindexed (Context Expert) and re-graphed (Graphify) once when the task ends.</p>
                    <p className="text-slate-600 mt-1">The same status appears on the Chat header badge so you never act on a stale answer without knowing it.</p>
                </div>
            </div>
        </div>
    );
}
