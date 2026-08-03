/**
 * SpecDiff — operation-grouped spec delta viewer.
 *
 * Renders deltas for a selected change, grouped by operation (ADDED/MODIFIED/
 * REMOVED/RENAMED) with colour-coded badges and left-border accents.
 * Three view modes: Current (spec as-is), Proposed (deltas only), Side-by-side.
 */

import React, { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, ArrowLeftRight, FileText, Columns, Eye } from 'lucide-react';
import { api } from '../api/api';

const OP_BADGES = {
    ADDED: { icon: Plus, color: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10', border: 'border-l-emerald-400', label: 'Added' },
    MODIFIED: { icon: Pencil, color: 'text-amber-400 border-amber-500/20 bg-amber-500/10', border: 'border-l-amber-400', label: 'Modified' },
    REMOVED: { icon: Trash2, color: 'text-red-400 border-red-500/20 bg-red-500/10', border: 'border-l-red-400', label: 'Removed' },
    RENAMED: { icon: ArrowLeftRight, color: 'text-cyan-400 border-cyan-500/20 bg-cyan-500/10', border: 'border-l-cyan-400', label: 'Renamed' },
};

export default function SpecDiff({ changeName, projectRoot }) {
    const [deltas, setDeltas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [viewMode, setViewMode] = useState('side-by-side'); // 'proposed' | 'side-by-side'
    const [selectedSpec, setSelectedSpec] = useState(null);

    useEffect(() => {
        if (!changeName) return;
        setLoading(true);
        setError(null);
        api.stardustDeltas(changeName, projectRoot)
            .then(data => {
                setDeltas(data.deltas || []);
                // Auto-select first spec
                const specs = [...new Set((data.deltas || []).map(d => d.specId))];
                if (specs.length > 0 && !selectedSpec) setSelectedSpec(specs[0]);
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [changeName, projectRoot]);

    if (!changeName) {
        return (
            <div className="flex items-center justify-center h-48 text-xs text-slate-600 italic">
                Select a change to view its spec deltas
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-48">
                <div className="animate-spin h-5 w-5 border-2 border-amber-400 border-t-transparent rounded-full" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-xs text-red-400">
                {error}
            </div>
        );
    }

    // Group deltas by operation
    const grouped = {};
    for (const d of deltas) {
        if (selectedSpec && d.specId !== selectedSpec) continue;
        if (!grouped[d.op]) grouped[d.op] = [];
        grouped[d.op].push(d);
    }

    const ops = ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED'];
    const specIds = [...new Set(deltas.map(d => d.specId))];

    return (
        <div className="space-y-4">
            {/* Header with spec selector and view toggle */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    {specIds.length > 1 && (
                        <div className="flex items-center gap-1">
                            {specIds.map(id => (
                                <button
                                    key={id}
                                    onClick={() => setSelectedSpec(id)}
                                    className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg border transition-colors ${
                                        selectedSpec === id
                                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                                            : 'border-white/5 text-slate-500 hover:text-slate-300'
                                    }`}
                                >
                                    {id}
                                </button>
                            ))}
                        </div>
                    )}
                    {specIds.length <= 1 && deltas.length > 0 && (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            {deltas.length} requirement{deltas.length !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1 bg-white/[0.03] rounded-lg border border-white/5 p-0.5">
                    <ViewToggle
                        icon={FileText}
                        label="Proposed"
                        active={viewMode === 'proposed'}
                        onClick={() => setViewMode('proposed')}
                    />
                    <ViewToggle
                        icon={Columns}
                        label="Side-by-side"
                        active={viewMode === 'side-by-side'}
                        onClick={() => setViewMode('side-by-side')}
                    />
                </div>
            </div>

            {/* No deltas */}
            {deltas.length === 0 && (
                <div className="rounded-xl bg-black/25 border border-white/5 p-6 text-center text-xs text-slate-500 italic">
                    No spec deltas found for this change. Create or edit specs under openspec/changes/{changeName}/specs/.
                </div>
            )}

            {/* Delta groups */}
            <div className={viewMode === 'side-by-side' ? 'grid grid-cols-1 lg:grid-cols-2 gap-4' : 'space-y-4'}>
                {viewMode === 'side-by-side' && (
                    <>
                        {/* Current spec column (placeholder — shows proposed as current reflection) */}
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 px-1">
                                Current Spec
                            </div>
                            <div className="space-y-3">
                                {ops.map(op => {
                                    const items = grouped[op];
                                    if (!items || items.length === 0) return null;
                                    return items.map((delta, i) => (
                                        <div key={`current-${op}-${i}`} className="rounded-xl border border-white/5 bg-black/25 p-3">
                                            <div className="text-xs text-slate-400 leading-relaxed opacity-70">
                                                {delta.body || <span className="italic text-slate-600">(current version)</span>}
                                            </div>
                                        </div>
                                    ));
                                })}
                            </div>
                        </div>
                        {/* Proposed column */}
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400 mb-3 px-1">
                                Proposed Changes
                            </div>
                            <DeltaGroups grouped={grouped} ops={ops} />
                        </div>
                    </>
                )}
                {viewMode !== 'side-by-side' && <DeltaGroups grouped={grouped} ops={ops} />}
            </div>
        </div>
    );
}

function DeltaGroups({ grouped, ops }) {
    return ops.map(op => {
        const items = grouped[op];
        if (!items || items.length === 0) return null;
        const badge = OP_BADGES[op] || OP_BADGES.ADDED;
        const BadgeIcon = badge.icon;
        return (
            <div key={op} className="space-y-3">
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${badge.color} w-fit`}>
                    <BadgeIcon size={12} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{badge.label}</span>
                    <span className="text-[10px] opacity-50 ml-1">{items.length}</span>
                </div>
                {items.map((delta, i) => (
                    <div
                        key={`${op}-${i}`}
                        className={`rounded-xl border border-white/5 bg-black/25 border-l-2 ${badge.border} p-3 ml-1`}
                    >
                        <h4 className="text-xs font-bold text-white mb-1.5">{delta.requirement}</h4>
                        <div className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
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
            onClick={onClick}
            className={`flex items-center gap-1 px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-colors ${
                active
                    ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                    : 'text-slate-500 hover:text-slate-300'
            }`}
        >
            <Icon size={11} />
            {label}
        </button>
    );
}
