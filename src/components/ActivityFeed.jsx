/**
 * ActivityFeed — live file events from the watched openspec/ directory.
 *
 * Two presentations of the same stream:
 *   ActivityDrawer — the header slide-over, available from every sub-tab
 *   ActivityRail   — an inline column on the Board, so the live feed the dashboard
 *                    promises is visible without opening anything
 */

import React, { useState } from 'react';
import {
    FilePlus2, PenLine, FileX2, Activity, X, FolderPlus, FolderX, FileText,
} from 'lucide-react';

const EVENT_ICONS = {
    created: FilePlus2,
    modified: PenLine,
    removed: FileX2,
    'directory created': FolderPlus,
    'directory removed': FolderX,
};

const EVENT_COLORS = {
    created: 'text-emerald-400',
    modified: 'text-amber-400',
    removed: 'text-red-400',
    'directory created': 'text-emerald-400',
    'directory removed': 'text-red-400',
};

function timeOfDay(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function EventRow({ entry, dense = false }) {
    // An unrecognized event name must still render — falling through to an
    // undefined component used to take the whole feed down.
    const Icon = EVENT_ICONS[entry.event] || FileText;
    const color = EVENT_COLORS[entry.event] || 'text-slate-400';
    return (
        <div className={`flex items-start gap-2.5 hover:bg-white/[0.02] transition-colors ${dense ? 'px-3 py-2' : 'px-5 py-3'}`}>
            <Icon size={13} className={`shrink-0 mt-0.5 ${color}`} />
            <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] text-slate-300 truncate" title={entry.path}>{entry.path}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 truncate">{entry.detail || entry.event}</div>
            </div>
            <span className="shrink-0 text-[10px] text-slate-600 tabular-nums">{timeOfDay(entry.timestamp)}</span>
        </div>
    );
}

function EmptyFeed({ compact = false }) {
    return (
        <div className={`flex flex-col items-center justify-center gap-2 text-center ${compact ? 'py-10' : 'h-48'}`}>
            <Activity size={20} className="text-slate-600 opacity-40" />
            <span className="text-xs text-slate-600 italic">No activity yet</span>
            <span className="text-[10px] text-slate-700">File events under openspec/ appear here in real time</span>
        </div>
    );
}

export function ActivityDrawer({ activity }) {
    const [open, setOpen] = useState(false);
    const newest = [...activity].reverse();

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="relative flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-white hover:border-white/20 transition-colors"
            >
                <Activity size={12} />
                Activity
                {activity.length > 0 && (
                    <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-amber-500 flex items-center justify-center text-[8px] font-bold text-black">
                        {activity.length > 9 ? '9+' : activity.length}
                    </span>
                )}
            </button>

            {open && (
                <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
            )}

            <div
                className={`fixed top-0 right-0 z-50 h-full w-96 max-w-full bg-[#020617] border-l border-white/5 shadow-2xl transform transition-transform duration-300 ${
                    open ? 'translate-x-0' : 'translate-x-full'
                }`}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                    <div className="flex items-center gap-2">
                        <Activity size={14} className="text-amber-400" />
                        <h2 className="text-xs font-bold uppercase tracking-widest text-white">Activity Feed</h2>
                        {activity.length > 0 && (
                            <span className="text-[10px] text-slate-600">{activity.length}</span>
                        )}
                    </div>
                    <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="overflow-y-auto custom-scrollbar h-[calc(100%-57px)]">
                    {newest.length === 0 ? <EmptyFeed /> : (
                        <div className="divide-y divide-white/[0.03]">
                            {newest.map((entry, i) => <EventRow key={`${entry.timestamp}-${i}`} entry={entry} />)}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

/**
 * Inline feed for the Board. Capped so a burst of file events cannot grow the
 * board's column unbounded; the drawer holds the full history.
 */
export function ActivityRail({ activity, limit = 40, connected }) {
    const newest = [...activity].reverse().slice(0, limit);

    return (
        <section className="rounded-2xl border border-white/5 bg-white/[0.02] flex flex-col h-full">
            <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/5">
                <Activity size={14} className="text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Live Activity</span>
                <span
                    className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}
                    title={connected ? 'Watching openspec/' : 'Not connected'}
                />
                {activity.length > 0 && (
                    <span className="ml-auto text-[10px] text-slate-600">{activity.length} event{activity.length === 1 ? '' : 's'}</span>
                )}
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {newest.length === 0 ? <EmptyFeed compact /> : (
                    <div className="divide-y divide-white/[0.03]">
                        {newest.map((entry, i) => <EventRow key={`${entry.timestamp}-${i}`} entry={entry} dense />)}
                    </div>
                )}
            </div>
        </section>
    );
}
