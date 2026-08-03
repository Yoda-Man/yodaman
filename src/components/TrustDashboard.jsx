/**
 * TrustDashboard — one honest verdict across Context Expert, Graphify and OpenSpec.
 *
 * The layer states come from WorkspaceReadiness and the drift report, not from
 * whether a CLI happens to be on PATH. That distinction is the whole point: an
 * installed Graphify with no graph built is not "ready", and reporting it as
 * ready while the detail line said "no graph built" was worse than saying nothing.
 *
 * Every card names the tab that consumes that tool, so a degraded layer is one
 * click from the view that depends on it.
 */

import React from 'react';
import {
    Shield, Database, GitBranch, FileText, RefreshCw, CheckCircle2, AlertTriangle,
    Clock, XCircle, ArrowRight, GitCompare, Info, HelpCircle,
} from 'lucide-react';
import { Panel, Label, Explainer, GhostButton, Centered, Spinner, StatTile } from './StardustKit';

const STATES = {
    ready: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/[0.05]', border: 'border-emerald-500/20', label: 'Ready' },
    stale: { icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/[0.05]', border: 'border-amber-500/20', label: 'Stale' },
    building: { icon: RefreshCw, color: 'text-cyan-400', bg: 'bg-cyan-500/[0.05]', border: 'border-cyan-500/20', label: 'Working' },
    unindexed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/[0.05]', border: 'border-red-500/20', label: 'Missing' },
    unavailable: { icon: HelpCircle, color: 'text-slate-400', bg: 'bg-white/[0.02]', border: 'border-white/5', label: 'Unknown' },
};

function stateOf(state) {
    return STATES[state] || STATES.unavailable;
}

export default function TrustDashboard({ pipeline, loading, onRefresh, onNavigate }) {
    if (!pipeline?.loaded && loading) {
        return <Panel title="Workspace Trust" icon={Shield} color="indigo"><Centered><Spinner /></Centered></Panel>;
    }

    const { layers, overall, reason, action, health, drift } = pipeline;
    const verdict = stateOf(overall);
    const VerdictIcon = verdict.icon;

    const tools = [
        {
            name: 'Context Expert',
            icon: Database,
            layer: layers.ctx,
            desc: 'Semantic code search and indexing',
            feeds: 'Trace',
            feedsTab: 'trace',
            feedsWhy: 'ranks search hits by embedding similarity',
        },
        {
            name: 'Graphify',
            icon: GitBranch,
            layer: layers.graph,
            desc: 'Knowledge graph for structural queries',
            feeds: 'Compose',
            feedsTab: 'compose',
            feedsWhy: 'supplies dependents, blast radius and test coverage',
        },
        {
            name: 'OpenSpec',
            icon: FileText,
            layer: layers.spec,
            desc: 'Spec-driven architecture intent',
            feeds: 'Board',
            feedsTab: 'board',
            feedsWhy: 'holds the changes and spec deltas under review',
        },
    ];

    const degraded = (health?.degraded || []);
    const pending = (health?.pending || []);

    return (
        <div className="space-y-4">
            {/* Verdict + drift, across the full width */}
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
                <div className={`xl:col-span-2 rounded-2xl border ${verdict.border} ${verdict.bg} px-5 py-4 flex items-center gap-4`}>
                    <div className={`shrink-0 inline-flex items-center justify-center h-12 w-12 rounded-xl ${verdict.bg} border ${verdict.border}`}>
                        <VerdictIcon size={24} className={verdict.color} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <h3 className={`text-sm font-bold ${verdict.color}`}>{verdict.label}</h3>
                            <Label>weakest of three</Label>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 truncate" title={reason}>{reason}</p>
                        {action && <p className="text-[10px] text-slate-500 mt-1">{action}</p>}
                    </div>
                    <div className="shrink-0">
                        <GhostButton icon={RefreshCw} label="Recheck" color="indigo" loading={loading} onClick={onRefresh} />
                    </div>
                </div>

                <StatTile
                    label="Stale references"
                    value={drift?.available ? drift.staleCount : '—'}
                    hint={drift?.available ? 'specs citing missing files' : 'drift unavailable'}
                    color={drift?.available ? (drift.staleCount === 0 ? 'emerald' : 'red') : 'slate'}
                    icon={GitCompare}
                    onClick={() => onNavigate?.('drift')}
                />
                <StatTile
                    label="Undocumented"
                    value={drift?.available ? drift.undocumentedCount : '—'}
                    hint={drift?.available ? 'load-bearing, unspecified' : 'drift unavailable'}
                    color={drift?.available ? (drift.undocumentedCount === 0 ? 'emerald' : 'indigo') : 'slate'}
                    icon={GitCompare}
                    onClick={() => onNavigate?.('drift')}
                />
            </div>

            {/* Per-tool cards — each links to the tab it feeds */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {tools.map(tool => {
                    const s = stateOf(tool.layer.state);
                    const StateIcon = s.icon;
                    return (
                        <div key={tool.name} className={`rounded-2xl border ${s.border} ${s.bg} flex flex-col`}>
                            <div className="flex items-center gap-2 px-4 pt-4 pb-3">
                                <tool.icon size={14} className={s.color} />
                                <Label color="text-slate-300">{tool.name}</Label>
                                {tool.layer.version && (
                                    <span className="ml-auto text-[9px] font-mono text-slate-600">v{tool.layer.version}</span>
                                )}
                            </div>

                            <div className="px-4 pb-3">
                                <div className="flex items-center gap-2 mb-1.5">
                                    <StateIcon size={18} className={`${s.color} ${tool.layer.state === 'building' ? 'animate-spin' : ''}`} />
                                    <span className={`text-sm font-bold ${s.color}`}>{s.label}</span>
                                </div>
                                <p className="text-[11px] text-slate-400 leading-relaxed">{tool.layer.detail}</p>
                            </div>

                            <div className="mt-auto px-4 pb-4 pt-3 border-t border-white/[0.04]">
                                <p className="text-[10px] text-slate-600 mb-2">{tool.desc}</p>
                                <button
                                    type="button"
                                    onClick={() => onNavigate?.(tool.feedsTab)}
                                    className="group w-full flex items-center gap-1.5 text-left"
                                    title={`Open ${tool.feeds} — ${tool.feedsWhy}`}
                                >
                                    <Label color="text-slate-500" className="group-hover:text-slate-300 transition-colors">
                                        Feeds {tool.feeds}
                                    </Label>
                                    <ArrowRight size={11} className="text-slate-600 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all" />
                                    <span className="ml-auto text-[9px] text-slate-700 truncate">{tool.feedsWhy}</span>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Runtime detail + the rules, side by side rather than stacked narrow */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                <Panel title="Runtime Checks" icon={Shield} color="indigo" fill>
                    {degraded.length === 0 && pending.length === 0 ? (
                        <div className="flex items-center gap-2 py-2 text-[11px] text-emerald-400">
                            <CheckCircle2 size={13} />
                            Every runtime dependency reported healthy.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {degraded.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <AlertTriangle size={12} className="text-red-400" />
                                        <Label color="text-red-400">Failing ({degraded.length})</Label>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {degraded.map(name => (
                                            <span key={name} className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1 font-mono text-[10px] text-red-300">
                                                {name}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {pending.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <Clock size={12} className="text-amber-400" />
                                        <Label color="text-amber-400">Still checking ({pending.length})</Label>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {pending.map(name => (
                                            <span key={name} className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] text-amber-300">
                                                {name}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </Panel>

                <Explainer title="How trust works" icon={Info}>
                    <p><b className="text-slate-400">Weakest layer wins.</b> The verdict above is the worst of the three tools — a stale graph drags the whole workspace down rather than hiding behind an average. The reason line names which layer set it.</p>
                    <p><b className="text-slate-400">Installed is not ready.</b> Graphify being on PATH says nothing about whether a graph exists for this workspace; OpenSpec being installed says nothing about whether any specs have been written. Both are judged on their output.</p>
                    <p><b className="text-slate-400">Post-write refresh.</b> After an agent task modifies files, touched workspaces are reindexed (Context Expert) and re-graphed (Graphify) once when the task ends.</p>
                    <p className="text-slate-600">The same verdict appears on the Chat header badge, so you never act on a stale answer without knowing it.</p>
                </Explainer>
            </div>
        </div>
    );
}
