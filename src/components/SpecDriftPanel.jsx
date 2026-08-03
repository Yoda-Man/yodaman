/**
 * SpecDriftPanel — architecture-vs-intent drift detection UI.
 *
 * Shows stale spec references (files cited in specs that no longer exist) and
 * undocumented modules (load-bearing files no spec describes). This is YodaMan's
 * unique capability — opsx-ui has no equivalent.
 */

import React, { useState, useEffect } from 'react';
import { AlertTriangle, FileQuestion, BarChart3, RefreshCw, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../api/api';

export default function SpecDriftPanel({ projectRoot }) {
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);

    const fetchDrift = async () => {
        if (!projectRoot) return;
        setLoading(true);
        try {
            const url = new URL(`${window.location.origin}/api/stardust/drift`);
            url.searchParams.append('projectRoot', projectRoot);
            const res = await fetch(url);
            const data = await res.json();
            setReport(data);
        } catch (_) {
            setReport(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchDrift(); }, [projectRoot]);

    if (!report) {
        return (
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                <div className="flex items-center gap-2 mb-4">
                    <BarChart3 size={16} className="text-indigo-400" />
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-300">Architecture Drift</span>
                </div>
                {loading ? (
                    <div className="flex items-center justify-center h-20">
                        <Loader2 size={16} className="animate-spin text-slate-500" />
                    </div>
                ) : (
                    <div className="text-xs text-slate-600 italic">
                        Drift analysis unavailable — ensure OpenSpec is initialized and a knowledge graph has been built.
                    </div>
                )}
            </div>
        );
    }

    if (!report.available) {
        return (
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                <div className="flex items-center gap-2 mb-4">
                    <BarChart3 size={16} className="text-indigo-400" />
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-300">Architecture Drift</span>
                    <button onClick={fetchDrift} disabled={loading} className="ml-auto text-slate-600 hover:text-slate-400">
                        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                    <AlertTriangle size={13} className="text-amber-400" />
                    {report.reason}
                </div>
            </div>
        );
    }

    const { staleReferences, undocumented, inSync, specCount, graphFileCount, documentedFiles } = report;

    return (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={16} className="text-indigo-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-300">Architecture Drift</span>
                <button onClick={fetchDrift} disabled={loading} className="ml-auto text-slate-600 hover:text-slate-400">
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Status banner */}
            <div className={`rounded-xl border px-4 py-3 mb-4 flex items-center gap-2 ${
                inSync
                    ? 'border-emerald-500/20 bg-emerald-500/[0.05]'
                    : 'border-amber-500/20 bg-amber-500/[0.05]'
            }`}>
                {inSync ? (
                    <CheckCircle2 size={16} className="text-emerald-400" />
                ) : (
                    <AlertTriangle size={16} className="text-amber-400" />
                )}
                <div>
                    <div className={`text-xs font-bold ${inSync ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {inSync ? 'Specs and code agree' : 'Drift detected'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                        {specCount} spec{specCount !== 1 ? 's' : ''} · {graphFileCount} graph files · {documentedFiles} documented
                    </div>
                </div>
            </div>

            {/* Stale references */}
            {staleReferences.length > 0 && (
                <div className="mb-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-2">
                        {staleReferences.length} Stale Reference{staleReferences.length !== 1 ? 's' : ''}
                    </div>
                    <div className="space-y-1.5">
                        {staleReferences.slice(0, 5).map((sr, i) => (
                            <div key={i} className="flex items-start gap-2 text-[11px] rounded-lg bg-red-500/[0.04] border border-red-500/10 px-3 py-2">
                                <AlertTriangle size={12} className="text-red-400 shrink-0 mt-0.5" />
                                <div>
                                    <span className="text-slate-300 font-mono">{sr.reference}</span>
                                    <span className="text-slate-600"> — cited in </span>
                                    <span className="text-slate-400">{sr.spec}</span>
                                </div>
                            </div>
                        ))}
                        {staleReferences.length > 5 && (
                            <div className="text-[10px] text-slate-600 italic px-3">
                                … and {staleReferences.length - 5} more
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Undocumented modules */}
            {undocumented.length > 0 && (
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-2">
                        {undocumented.length} Undocumented Module{undocumented.length !== 1 ? 's' : ''}
                    </div>
                    <div className="space-y-1.5">
                        {undocumented.slice(0, 5).map((entry, i) => (
                            <div key={i} className="flex items-center justify-between text-[11px] rounded-lg bg-indigo-500/[0.04] border border-indigo-500/10 px-3 py-2">
                                <div className="flex items-center gap-2">
                                    <FileQuestion size={12} className="text-indigo-400 shrink-0" />
                                    <span className="text-slate-300 font-mono">{entry.file}</span>
                                </div>
                                <span className="text-slate-600 shrink-0">{entry.dependents} dependent{entry.dependents !== 1 ? 's' : ''}</span>
                            </div>
                        ))}
                        {undocumented.length > 5 && (
                            <div className="text-[10px] text-slate-600 italic px-3">
                                … and {undocumented.length - 5} more
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
