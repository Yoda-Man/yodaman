/**
 * SpecDiff — operation-grouped spec delta viewer.
 *
 * Renders a change's deltas grouped by operation (ADDED / MODIFIED / REMOVED /
 * RENAMED) with colour-coded badges and left-border accents.
 *
 * Side-by-side shows the published spec on the left and the proposed deltas on the
 * right. The left column reads the real file from openspec/specs/ — it used to
 * restate the proposal under a "Current Spec" heading, which read as though the
 * change had already landed.
 */

import React, { useState, useEffect } from 'react';
import {
    Plus, Pencil, Trash2, ArrowLeftRight, FileText, Columns, FilePlus,
} from 'lucide-react';
import { api } from '../api/api';
import { Centered, Spinner, Label, ErrorNote, EmptyState } from './StardustKit';

const OP_BADGES = {
    ADDED: { icon: Plus, color: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10', border: 'border-l-emerald-400', label: 'Added' },
    MODIFIED: { icon: Pencil, color: 'text-amber-400 border-amber-500/20 bg-amber-500/10', border: 'border-l-amber-400', label: 'Modified' },
    REMOVED: { icon: Trash2, color: 'text-red-400 border-red-500/20 bg-red-500/10', border: 'border-l-red-400', label: 'Removed' },
    RENAMED: { icon: ArrowLeftRight, color: 'text-cyan-400 border-cyan-500/20 bg-cyan-500/10', border: 'border-l-cyan-400', label: 'Renamed' },
};

const OPS = ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED'];

export default function SpecDiff({ changeName, projectRoot }) {
    const [deltas, setDeltas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [viewMode, setViewMode] = useState('side-by-side'); // 'proposed' | 'side-by-side'
    const [selectedSpec, setSelectedSpec] = useState(null);
    const [currentSpec, setCurrentSpec] = useState(null);

    useEffect(() => {
        if (!changeName) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        // Reset the spec filter for the new change: keeping the previous change's
        // selection filtered every delta out and rendered an empty diff.
        setSelectedSpec(null);
        api.stardustDeltas(changeName, projectRoot)
            .then(data => {
                if (cancelled) return;
                const next = data.deltas || [];
                setDeltas(next);
                const specs = [...new Set(next.map(d => d.specId))];
                if (specs.length > 0) setSelectedSpec(specs[0]);
            })
            .catch(err => { if (!cancelled) setError(err.message); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [changeName, projectRoot]);

    // Load the published spec whenever the selected one changes, so the left-hand
    // column of the diff is the actual current text.
    useEffect(() => {
        if (!selectedSpec) {
            setCurrentSpec(null);
            return;
        }
        let cancelled = false;
        setCurrentSpec({ loading: true });
        api.stardustSpec(projectRoot, selectedSpec)
            .then(data => { if (!cancelled) setCurrentSpec(data); })
            .catch(err => { if (!cancelled) setCurrentSpec({ available: false, reason: err.message }); });
        return () => { cancelled = true; };
    }, [selectedSpec, projectRoot]);

    if (!changeName) {
        return <EmptyState icon={FileText} title="Select a change to view its spec deltas" compact />;
    }

    if (loading) {
        return <Centered className="min-h-[200px]"><Spinner size={20} className="text-amber-400" /></Centered>;
    }

    if (error) return <ErrorNote>{error}</ErrorNote>;

    const grouped = {};
    for (const d of deltas) {
        if (selectedSpec && d.specId !== selectedSpec) continue;
        if (!grouped[d.op]) grouped[d.op] = [];
        grouped[d.op].push(d);
    }

    const specIds = [...new Set(deltas.map(d => d.specId))];
    const shown = OPS.reduce((sum, op) => sum + (grouped[op]?.length || 0), 0);

    return (
        <div className="space-y-4">
            {/* Spec selector + view toggle */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                    {specIds.length > 1 ? (
                        <>
                            <Label>Spec</Label>
                            {specIds.map(id => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setSelectedSpec(id)}
                                    className={`rounded-lg border px-2.5 py-1 font-mono text-[10px] font-bold transition-colors ${
                                        selectedSpec === id
                                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                                            : 'border-white/5 text-slate-500 hover:text-slate-300 hover:border-white/10'
                                    }`}
                                >
                                    {id}
                                </button>
                            ))}
                        </>
                    ) : (
                        <Label>
                            {shown} requirement{shown !== 1 ? 's' : ''}
                            {specIds.length === 1 ? ` in ${specIds[0]}` : ''}
                        </Label>
                    )}
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-white/5 bg-white/[0.03] p-0.5">
                    <ViewToggle icon={FileText} label="Proposed" active={viewMode === 'proposed'} onClick={() => setViewMode('proposed')} />
                    <ViewToggle icon={Columns} label="Side-by-side" active={viewMode === 'side-by-side'} onClick={() => setViewMode('side-by-side')} />
                </div>
            </div>

            {deltas.length === 0 ? (
                <EmptyState
                    compact
                    icon={FileText}
                    title="No spec deltas for this change"
                    hint={`Create or edit specs under openspec/changes/${changeName}/specs/ to describe what this change adds, modifies or removes.`}
                />
            ) : viewMode === 'side-by-side' ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                    <div>
                        <div className="flex items-center gap-2 mb-3 px-1">
                            <Label>Current Spec</Label>
                            {currentSpec?.path && (
                                <span className="font-mono text-[10px] text-slate-600 truncate">{currentSpec.path}</span>
                            )}
                        </div>
                        <CurrentSpec spec={currentSpec} />
                    </div>
                    <div>
                        <div className="mb-3 px-1">
                            <Label color="text-amber-400">Proposed Changes</Label>
                        </div>
                        <div className="space-y-4">
                            <DeltaGroups grouped={grouped} />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4 items-start">
                    <DeltaGroups grouped={grouped} />
                </div>
            )}
        </div>
    );
}

function CurrentSpec({ spec }) {
    if (!spec) return null;

    if (spec.loading) {
        return (
            <div className="rounded-xl border border-white/5 bg-black/25 p-4">
                <Centered className="min-h-[120px]"><Spinner /></Centered>
            </div>
        );
    }

    if (!spec.available) {
        return (
            <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/[0.03] p-5">
                <div className="flex items-start gap-2.5">
                    <FilePlus size={14} className="shrink-0 mt-0.5 text-emerald-400" />
                    <div>
                        <p className="text-[11px] text-emerald-400 font-bold mb-1">Nothing published yet</p>
                        <p className="text-[10px] text-slate-500 leading-relaxed">{spec.reason}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-white/5 bg-black/25 p-4 max-h-[560px] overflow-y-auto custom-scrollbar">
            <pre className="font-mono text-[11px] leading-relaxed text-slate-400 whitespace-pre-wrap break-words">
                {spec.text}
            </pre>
        </div>
    );
}

function DeltaGroups({ grouped }) {
    return OPS.map(op => {
        const items = grouped[op];
        if (!items || items.length === 0) return null;
        const badge = OP_BADGES[op] || OP_BADGES.ADDED;
        const BadgeIcon = badge.icon;
        return (
            <div key={op} className="space-y-2.5">
                <div className={`flex w-fit items-center gap-1.5 rounded-lg border px-2 py-1 ${badge.color}`}>
                    <BadgeIcon size={12} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{badge.label}</span>
                    <span className="ml-1 text-[10px] opacity-50">{items.length}</span>
                </div>
                {items.map((delta, i) => (
                    <div
                        key={`${op}-${delta.requirement}-${i}`}
                        className={`ml-1 rounded-xl border border-white/5 border-l-2 bg-black/25 p-3.5 ${badge.border}`}
                    >
                        <h4 className="mb-1.5 text-xs font-bold text-white">{delta.requirement}</h4>
                        <div className="text-[11px] leading-relaxed text-slate-400 whitespace-pre-wrap break-words">
                            {delta.body}
                        </div>
                    </div>
                ))}
            </div>
        );
    });
}

function ViewToggle({ icon: Icon, label, active, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center gap-1 rounded-md px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                active ? 'border border-amber-500/20 bg-amber-500/10 text-amber-300' : 'text-slate-500 hover:text-slate-300'
            }`}
        >
            <Icon size={11} />
            {label}
        </button>
    );
}
