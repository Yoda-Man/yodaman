/**
 * PipelineStrip — the three mandatory tools, drawn as the pipeline they form.
 *
 * Context Expert → Graphify → OpenSpec, with the arrows shown, on every sub-tab.
 * Each segment is a link into the tab that consumes that tool's output, so the
 * claim that the tools feed each other is navigable rather than asserted:
 *
 *   Context Expert  →  Trace    (semantic hits, ranked by the graph)
 *   Graphify        →  Compose  (structure around one file)
 *   OpenSpec        →  Board    (changes and their spec deltas)
 *   all three       →  Drift    (intent vs. reality — the cross-tool product)
 *
 * The focus chip on the right is the file currently being handed between tabs.
 */

import React from 'react';
import { Database, GitBranch, FileText, ChevronRight, GitCompare, X, Crosshair, RefreshCw } from 'lucide-react';
import { Label } from './StardustKit';

const STATE_STYLES = {
    ready: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Ready' },
    stale: { dot: 'bg-amber-400', text: 'text-amber-400', label: 'Stale' },
    building: { dot: 'bg-cyan-400 animate-pulse', text: 'text-cyan-400', label: 'Working' },
    unindexed: { dot: 'bg-red-400', text: 'text-red-400', label: 'Missing' },
    unavailable: { dot: 'bg-slate-600', text: 'text-slate-500', label: 'Unknown' },
};

function stateStyle(state) {
    return STATE_STYLES[state] || STATE_STYLES.unavailable;
}

function Segment({ icon: Icon, name, layer, feeds, onClick, active }) {
    const s = stateStyle(layer.state);
    return (
        <button
            type="button"
            onClick={onClick}
            title={`${name} — ${layer.detail}. Opens the ${feeds} tab.`}
            className={`group flex-1 min-w-0 flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all ${
                active
                    ? 'border-white/15 bg-white/[0.05]'
                    : 'border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]'
            }`}
        >
            <Icon size={14} className={`shrink-0 ${s.text}`} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300 truncate">{name}</span>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
                    <span className={`text-[9px] font-bold uppercase tracking-widest shrink-0 ${s.text}`}>{s.label}</span>
                </div>
                <div className="text-[10px] text-slate-500 truncate">{layer.detail}</div>
            </div>
            <span className="hidden 2xl:flex shrink-0 items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-slate-600 group-hover:text-slate-400 transition-colors">
                {feeds}
                <ChevronRight size={10} />
            </span>
        </button>
    );
}

function Feed() {
    return (
        <div className="hidden lg:flex shrink-0 items-center px-0.5 text-slate-700" aria-hidden="true">
            <ChevronRight size={14} />
        </div>
    );
}

export default function PipelineStrip({ pipeline, loading, onRefresh, activeTab, onNavigate, focusFile, onClearFocus }) {
    const { layers, drift } = pipeline;

    // Drift is the only reading that requires all three tools at once, so it sits
    // at the end of the chain rather than beside the individual tools.
    const driftLabel = !drift
        ? 'not checked'
        : drift.available === false
            ? 'unavailable'
            : drift.inSync
                ? 'specs agree with code'
                : `${drift.staleCount} stale · ${drift.undocumentedCount} undocumented`;

    const driftTone = !drift || drift.available === false
        ? 'text-slate-500'
        : drift.inSync ? 'text-emerald-400' : 'text-amber-400';

    return (
        <div className="flex items-stretch gap-1.5 flex-wrap xl:flex-nowrap">
            <Segment
                icon={Database}
                name="Context Expert"
                layer={layers.ctx}
                feeds="Trace"
                active={activeTab === 'trace'}
                onClick={() => onNavigate('trace')}
            />
            <Feed />
            <Segment
                icon={GitBranch}
                name="Graphify"
                layer={layers.graph}
                feeds="Compose"
                active={activeTab === 'compose'}
                onClick={() => onNavigate('compose')}
            />
            <Feed />
            <Segment
                icon={FileText}
                name="OpenSpec"
                layer={layers.spec}
                feeds="Board"
                active={activeTab === 'board'}
                onClick={() => onNavigate('board')}
            />
            <Feed />

            {/* The cross-tool product: intent measured against reality. */}
            <button
                type="button"
                onClick={() => onNavigate('drift')}
                title="Architecture drift — what the specs claim versus what the graph shows"
                className={`group flex-1 min-w-0 flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all ${
                    activeTab === 'drift'
                        ? 'border-amber-500/25 bg-amber-500/[0.06]'
                        : 'border-amber-500/10 bg-amber-500/[0.03] hover:border-amber-500/25 hover:bg-amber-500/[0.06]'
                }`}
            >
                <GitCompare size={14} className="shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-amber-300 truncate">Drift</div>
                    <div className={`text-[10px] truncate ${driftTone}`}>{driftLabel}</div>
                </div>
                <span className="hidden 2xl:flex shrink-0 items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-slate-600 group-hover:text-slate-400 transition-colors">
                    All three
                    <ChevronRight size={10} />
                </span>
            </button>

            {/* Focused file — what the tabs are currently handing to each other. */}
            {focusFile && (
                <div className="shrink-0 flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] px-3 py-2 max-w-[280px]">
                    <Crosshair size={12} className="shrink-0 text-indigo-400" />
                    <div className="min-w-0">
                        <Label color="text-indigo-400">Focus</Label>
                        <div className="font-mono text-[10px] text-slate-300 truncate" title={focusFile}>{focusFile}</div>
                    </div>
                    <button
                        type="button"
                        onClick={onClearFocus}
                        title="Clear focused file"
                        className="shrink-0 text-slate-500 hover:text-white transition-colors"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                title="Re-check all three tools"
                className="shrink-0 flex items-center justify-center rounded-xl border border-white/5 bg-white/[0.02] px-3 text-slate-500 hover:text-white hover:border-white/15 transition-colors disabled:opacity-40"
            >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
        </div>
    );
}
