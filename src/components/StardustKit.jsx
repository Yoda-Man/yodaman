/**
 * StardustKit — the shared primitives every Stardust sub-tab is built from.
 *
 * The sub-tabs used to each invent their own card, stat and empty-state markup
 * inside a `max-w-*` column, so they disagreed visually and wasted most of a wide
 * screen. These primitives are width-agnostic: they fill whatever grid cell they
 * are placed in, and the sub-tab owns the grid.
 *
 * FileChip is the piece that makes the tabs a pipeline rather than seven
 * dead ends — any file rendered anywhere in Stardust is a handoff into Compose.
 */

import React from 'react';
import { ArrowRight, Loader2, Link2 } from 'lucide-react';

// Every colour class is written out in full. Tailwind scans source text, so a
// class assembled at runtime from fragments would never be generated.
export const ACCENTS = {
    amber: { text: 'text-amber-400', border: 'border-amber-500/20', bg: 'bg-amber-500/10', soft: 'bg-amber-500/[0.04]', ring: 'ring-amber-500/20', bar: 'bg-amber-400/70' },
    cyan: { text: 'text-cyan-400', border: 'border-cyan-500/20', bg: 'bg-cyan-500/10', soft: 'bg-cyan-500/[0.04]', ring: 'ring-cyan-500/20', bar: 'bg-cyan-400/70' },
    indigo: { text: 'text-indigo-400', border: 'border-indigo-500/20', bg: 'bg-indigo-500/10', soft: 'bg-indigo-500/[0.04]', ring: 'ring-indigo-500/20', bar: 'bg-indigo-400/70' },
    emerald: { text: 'text-emerald-400', border: 'border-emerald-500/20', bg: 'bg-emerald-500/10', soft: 'bg-emerald-500/[0.04]', ring: 'ring-emerald-500/20', bar: 'bg-emerald-400/70' },
    red: { text: 'text-red-400', border: 'border-red-500/20', bg: 'bg-red-500/10', soft: 'bg-red-500/[0.04]', ring: 'ring-red-500/20', bar: 'bg-red-400/70' },
    purple: { text: 'text-purple-400', border: 'border-purple-500/20', bg: 'bg-purple-500/10', soft: 'bg-purple-500/[0.04]', ring: 'ring-purple-500/20', bar: 'bg-purple-400/70' },
    slate: { text: 'text-slate-400', border: 'border-white/5', bg: 'bg-white/[0.02]', soft: 'bg-black/25', ring: 'ring-white/10', bar: 'bg-slate-400/70' },
};

export function accent(name) {
    return ACCENTS[name] || ACCENTS.slate;
}

/** Section label — the small uppercase caption used throughout Stardust. */
export function Label({ children, color = 'text-slate-500', className = '' }) {
    return (
        <span className={`text-[10px] font-bold uppercase tracking-widest ${color} ${className}`}>
            {children}
        </span>
    );
}

/**
 * A full-width panel. `fill` makes it stretch to its grid row so side-by-side
 * panels line up instead of ending at different heights.
 */
export function Panel({ title, icon: Icon, color = 'indigo', action, children, fill = false, padded = true, className = '', bodyClassName = '' }) {
    const a = accent(color);
    return (
        <section className={`rounded-2xl border border-white/5 bg-white/[0.02] flex flex-col ${fill ? 'h-full' : ''} ${className}`}>
            {(title || action) && (
                <header className="shrink-0 flex items-center gap-2 px-5 py-3.5 border-b border-white/5">
                    {Icon && <Icon size={15} className={a.text} />}
                    <Label color="text-slate-300">{title}</Label>
                    {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
                </header>
            )}
            {/* `padded` rather than an overriding class: Tailwind resolves px-5 after
                p-0 regardless of the order they appear in the attribute. */}
            <div className={`flex-1 min-h-0 ${padded ? 'px-5 py-4' : ''} ${bodyClassName}`}>{children}</div>
        </section>
    );
}

/** Big-number tile for the stat strips that head each tab. */
export function StatTile({ label, value, hint, color = 'slate', icon: Icon, onClick }) {
    const a = accent(color);
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag
            {...(onClick ? { onClick, type: 'button' } : {})}
            className={`rounded-2xl border ${a.border} ${a.soft} px-4 py-3 text-left transition-all ${
                onClick ? 'hover:bg-white/[0.05] hover:border-white/20 cursor-pointer' : ''
            }`}
        >
            <div className="flex items-center gap-1.5 mb-1.5">
                {Icon && <Icon size={12} className={a.text} />}
                <Label>{label}</Label>
            </div>
            <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-bold leading-none ${color === 'slate' ? 'text-white' : a.text}`}>{value}</span>
                {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
            </div>
        </Tag>
    );
}

/**
 * A file path rendered as a handoff into Compose.
 *
 * Every file surfaced by any tool is actionable: click it and the cross-tool view
 * opens on that file. This is what stops each tab from being a dead end.
 */
export function FileChip({ file, onOpen, color = 'slate', trailing, title }) {
    const a = accent(color);
    if (!onOpen) {
        return (
            <span className="font-mono text-[11px] text-slate-300 truncate" title={title || file}>{file}</span>
        );
    }
    return (
        <button
            type="button"
            onClick={() => onOpen(file)}
            title={title || `Cross-reference ${file} across all three tools`}
            className={`group/chip w-full flex items-center gap-2 rounded-lg border border-transparent ${a.soft} px-3 py-2 text-left transition-all hover:border-white/10 hover:bg-white/[0.05]`}
        >
            <Link2 size={11} className={`shrink-0 opacity-0 group-hover/chip:opacity-100 transition-opacity ${a.text}`} />
            <span className="font-mono text-[11px] text-slate-300 truncate group-hover/chip:text-white transition-colors">{file}</span>
            {trailing && <span className="ml-auto shrink-0 text-[10px] text-slate-600">{trailing}</span>}
            <ArrowRight size={11} className="shrink-0 text-slate-600 opacity-0 group-hover/chip:opacity-100 transition-opacity" />
        </button>
    );
}

/** Horizontal 0..1 signal bar — used wherever a weighted score is explained. */
export function SignalBar({ label, value, weight, color = 'indigo', showValue = true }) {
    const a = accent(color);
    const pct = Math.max(0, Math.min(100, (Number(value) || 0) * 100));
    return (
        <div className="flex items-center gap-2">
            <span className={`w-[74px] shrink-0 text-[9px] font-bold uppercase tracking-widest ${a.text}`}>{label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div className={`h-full rounded-full ${a.bar} transition-all duration-500`} style={{ width: `${pct}%` }} />
            </div>
            {showValue && (
                <span className={`w-9 shrink-0 text-right text-[9px] font-mono ${a.text}`}>{(Number(value) || 0).toFixed(2)}</span>
            )}
            {weight !== undefined && (
                <span className="w-8 shrink-0 text-right text-[9px] font-mono text-slate-600">×{weight}</span>
            )}
        </div>
    );
}

/** Key/value row for the dense metric lists inside panels. */
export function StatRow({ label, value, icon: Icon, color = 'slate' }) {
    const a = accent(color);
    return (
        <div className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.03] last:border-0">
            <span className="text-[10px] text-slate-500 truncate">{label}</span>
            <div className="flex items-center gap-1.5 shrink-0">
                {Icon && <Icon size={11} className={a.text} />}
                <span className={`text-[10px] font-mono font-bold ${color === 'slate' ? 'text-slate-300' : a.text}`}>{value}</span>
            </div>
        </div>
    );
}

/** Centred empty state that fills its container rather than collapsing. */
export function EmptyState({ icon: Icon, title, hint, action, compact = false }) {
    return (
        <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'h-full min-h-[220px] py-10'}`}>
            {Icon && <Icon size={compact ? 22 : 28} className="text-slate-600 mb-3" />}
            <p className="text-xs text-slate-500 mb-1">{title}</p>
            {hint && <p className="text-[10px] text-slate-600 max-w-md leading-relaxed">{hint}</p>}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}

export function Spinner({ size = 16, className = '' }) {
    return <Loader2 size={size} className={`animate-spin text-slate-500 ${className}`} />;
}

export function Centered({ children, className = '' }) {
    return <div className={`flex items-center justify-center h-full min-h-[180px] ${className}`}>{children}</div>;
}

/** Inline error strip. */
export function ErrorNote({ children }) {
    return (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2.5 text-xs text-red-400">{children}</div>
    );
}

/** Explanatory footer — why a view says what it says. */
export function Explainer({ title = 'How this works', icon: Icon, children }) {
    return (
        <div className="rounded-2xl border border-white/5 bg-black/25 p-4">
            <div className="flex items-center gap-2 mb-2">
                {Icon && <Icon size={13} className="text-slate-400" />}
                <Label color="text-slate-400">{title}</Label>
            </div>
            <div className="text-[10px] text-slate-500 space-y-1.5 leading-relaxed">{children}</div>
        </div>
    );
}

/** Small pill button used for in-panel actions. */
export function GhostButton({ icon: Icon, label, onClick, color = 'indigo', loading, disabled, title }) {
    const a = accent(color);
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled || loading}
            title={title || label}
            className={`inline-flex items-center gap-1.5 rounded-lg border ${a.border} ${a.bg} px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${a.text} transition-all hover:bg-white/[0.06] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed`}
        >
            {loading ? <Loader2 size={11} className="animate-spin" /> : Icon && <Icon size={11} />}
            {label}
        </button>
    );
}
