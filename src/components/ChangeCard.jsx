/**
 * ChangeCard — a single OpenSpec change rendered as a clickable card.
 *
 * Shows: change name (mono), validation health icon, task progress bar,
 * status label, and relative "updated X ago" timestamp.
 */

import React, { useMemo } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, Clock, ArrowRight } from 'lucide-react';

const VALIDATION_ICONS = {
    ok: CheckCircle2,
    warn: AlertTriangle,
    error: XCircle,
    unknown: HelpCircle,
};

const VALIDATION_COLORS = {
    ok: 'text-emerald-400',
    warn: 'text-amber-400',
    error: 'text-red-400',
    unknown: 'text-slate-500',
};

const STATUS_COLORS = {
    proposed: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    validated: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    applied: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    archived: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

function ago(ms) {
    if (!ms) return '';
    const diff = Date.now() - ms;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    return `${days}d ago`;
}

export default function ChangeCard({ change, onClick, selected }) {
    const ValidationIcon = VALIDATION_ICONS[change.validation] || HelpCircle;
    const progress = change.taskTotal > 0
        ? Math.round((change.taskCompleted / change.taskTotal) * 100)
        : null;

    const timeAgo = useMemo(() => ago(change.mtimeMs), [change.mtimeMs]);

    return (
        <button
            onClick={() => onClick?.(change)}
            className={`w-full text-left rounded-2xl border transition-all duration-200 p-4 group ${
                selected
                    ? 'border-amber-500/30 bg-amber-500/[0.06] ring-1 ring-amber-500/20'
                    : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'
            }`}
        >
            {/* Top row: name + validation icon */}
            <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-mono text-sm text-white truncate group-hover:text-amber-300 transition-colors">
                    {change.name}
                </h3>
                <ValidationIcon
                    size={16}
                    className={`shrink-0 mt-0.5 ${VALIDATION_COLORS[change.validation]}`}
                />
            </div>

            {/* Status badge + time */}
            <div className="flex items-center gap-2 mb-3">
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-lg border ${STATUS_COLORS[change.status] || STATUS_COLORS.proposed}`}>
                    {change.status}
                </span>
                {timeAgo && (
                    <span className="text-[10px] text-slate-600 flex items-center gap-1">
                        <Clock size={10} />
                        {timeAgo}
                    </span>
                )}
            </div>

            {/* Task progress bar */}
            {progress !== null && (
                <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500">Tasks</span>
                        <span className="text-slate-400 font-mono">{change.taskCompleted}/{change.taskTotal}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${
                                progress === 100 ? 'bg-emerald-400' : progress > 50 ? 'bg-amber-400' : 'bg-indigo-400'
                            }`}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Hover hint */}
            <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity">
                <span>View details</span>
                <ArrowRight size={10} />
            </div>
        </button>
    );
}
