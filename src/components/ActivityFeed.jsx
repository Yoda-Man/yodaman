/**
 * ActivityFeed — slide-over drawer showing live file events from openspec/.
 *
 * Renders a reverse-chronological list with icons, target name, detail, and
 * timestamp. Uses a slide-over panel triggered from a header button.
 */

import React, { useState } from 'react';
import { FilePlus2, FilePenLine, FileX2, Activity, X, FolderPlus, FolderX } from 'lucide-react';

const EVENT_ICONS = {
    created: FilePlus2,
    modified: FilePenLine,
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

export function ActivityDrawer({ activity }) {
    const [open, setOpen] = useState(false);

    return (
        <>
            {/* Trigger button */}
            <button
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

            {/* Backdrop */}
            {open && (
                <div
                    className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
                    onClick={() => setOpen(false)}
                />
            )}

            {/* Slide-over panel */}
            <div
                className={`fixed top-0 right-0 z-50 h-full w-80 bg-[#020617] border-l border-white/5 shadow-2xl transform transition-transform duration-300 ${
                    open ? 'translate-x-0' : 'translate-x-full'
                }`}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                    <div className="flex items-center gap-2">
                        <Activity size={14} className="text-amber-400" />
                        <h2 className="text-xs font-bold uppercase tracking-widest text-white">Activity Feed</h2>
                    </div>
                    <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="overflow-y-auto h-[calc(100%-57px)]">
                    {activity.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 text-xs text-slate-600 italic gap-2">
                            <Activity size={20} className="opacity-30" />
                            No activity yet
                            <span className="text-[10px]">File events appear here in real time</span>
                        </div>
                    ) : (
                        <div className="divide-y divide-white/[0.03]">
                            {[...activity].reverse().map((entry, i) => {
                                const Icon = EVENT_ICONS[entry.event] || FilePenLine;
                                const color = EVENT_COLORS[entry.event] || 'text-slate-400';
                                return (
                                    <div key={`${entry.timestamp}-${i}`} className="px-5 py-3 hover:bg-white/[0.02] transition-colors">
                                        <div className="flex items-start gap-3">
                                            <Icon size={14} className={`shrink-0 mt-0.5 ${color}`} />
                                            <div className="min-w-0 flex-1">
                                                <div className="text-xs text-slate-300 truncate font-mono">
                                                    {entry.path}
                                                </div>
                                                <div className="text-[10px] text-slate-500 mt-0.5">
                                                    {entry.detail || entry.event}
                                                </div>
                                            </div>
                                            <span className="text-[10px] text-slate-600 shrink-0">
                                                {timeOfDay(entry.timestamp)}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
