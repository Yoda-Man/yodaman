/**
 * ImpactAnalysisTab — dedicated impact analysis tool in Stardust.
 *
 * Enter any file path to get the full blast radius breakdown with:
 * - Graphify structural impact (dependents, centrality, test coverage)
 * - OpenSpec spec awareness (which specs describe this file)
 * - Configurable depth (1-4 hops)
 * - Workspace readiness badge
 */

import React, { useState } from 'react';
import { Search, GitBranch, FileText, AlertTriangle, CheckCircle2, Shield, BarChart3, Link2 } from 'lucide-react';

const RISK_STYLES = {
    low: { label: 'Low risk', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
    moderate: { label: 'Review carefully', className: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
    high: { label: 'High risk', className: 'border-red-500/20 bg-red-500/10 text-red-300' },
};

export default function ImpactAnalysisTab({ projectRoot }) {
    const [filePath, setFilePath] = useState('');
    const [depth, setDepth] = useState(2);
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);

    const runAnalysis = async (e) => {
        e?.preventDefault();
        if (!filePath.trim()) return;
        setLoading(true);
        try {
            // Call the Stardust change-impact endpoint (works for any file)
            const url = new URL(`${window.location.origin}/api/stardust/change-impact/_any_`);
            url.searchParams.append('projectRoot', projectRoot || '');
            url.searchParams.append('file', filePath.trim());
            url.searchParams.append('depth', depth);

            // Also fetch compose data
            const composeUrl = new URL(`${window.location.origin}/api/stardust/compose`);
            composeUrl.searchParams.append('projectRoot', projectRoot || '');
            composeUrl.searchParams.append('file', filePath.trim());

            const [impactRes, composeRes] = await Promise.all([
                fetch(`/api/stardust/change-impact/_any_?projectRoot=${encodeURIComponent(projectRoot || '')}&file=${encodeURIComponent(filePath.trim())}&depth=${depth}`).then(r => r.json()).catch(() => null),
                fetch(`/api/stardust/compose?projectRoot=${encodeURIComponent(projectRoot || '')}&file=${encodeURIComponent(filePath.trim())}`).then(r => r.json()).catch(() => null),
            ]);

            setResult({ impact: impactRes, compose: composeRes });
        } catch (_) {
            setResult({ error: true });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Search bar */}
            <form onSubmit={runAnalysis} className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        type="text"
                        value={filePath}
                        onChange={e => setFilePath(e.target.value)}
                        placeholder="Enter a file path, e.g. backend/interfaces/RestController.js"
                        className="w-full rounded-xl bg-black/35 border border-white/10 pl-9 pr-4 py-2.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors font-mono"
                    />
                </div>
                <div className="flex items-center gap-1 bg-white/[0.03] rounded-lg border border-white/5 p-0.5">
                    {[1, 2, 3, 4].map(d => (
                        <button key={d} type="button" onClick={() => setDepth(d)}
                            className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-bold transition-colors ${
                                depth === d ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500 hover:text-slate-300'
                            }`}>{d} hop{d > 1 ? 's' : ''}</button>
                    ))}
                </div>
                <button type="submit" disabled={loading || !filePath.trim()}
                    className="shrink-0 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-indigo-300 hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:text-white disabled:opacity-40 transition-all">
                    {loading ? <div className="animate-spin h-4 w-4 border-2 border-indigo-400 border-t-transparent rounded-full" /> : 'Analyze'}
                </button>
            </form>

            {/* Empty state */}
            {!result && !loading && (
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center">
                    <BarChart3 size={28} className="text-slate-600 mx-auto mb-3" />
                    <p className="text-xs text-slate-500 mb-1">Impact analysis</p>
                    <p className="text-[10px] text-slate-600 max-w-md mx-auto">
                        Enter any file path to see its blast radius from the knowledge graph, which OpenSpec specs describe it, and whether tests cover the affected files. Adjust the hop depth to control how far the analysis reaches.
                    </p>
                </div>
            )}

            {/* Results */}
            {result && !result.error && (
                <div className="space-y-4">
                    {/* Risk verdict */}
                    {result.impact?.risk && (
                        <div className={`rounded-2xl border p-5 ${(RISK_STYLES[result.impact.risk] || RISK_STYLES.low).className}`}>
                            <div className="flex items-center gap-3">
                                <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-white/[0.05] border border-white/10">
                                    {result.impact.risk === 'high' ? <AlertTriangle size={24} className="text-red-400" />
                                        : result.impact.risk === 'moderate' ? <AlertTriangle size={24} className="text-amber-400" />
                                        : <CheckCircle2 size={24} className="text-emerald-400" />}
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-white capitalize">{result.impact.risk} risk</h3>
                                    <p className="text-[10px] text-slate-400 mt-0.5">
                                        {result.impact.impactedCount} dependent{result.impact.impactedCount !== 1 ? 's' : ''} within {depth} hop{depth > 1 ? 's' : ''}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Graphify stats */}
                        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <GitBranch size={14} className="text-cyan-400" />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Graphify — Structure</span>
                            </div>
                            <div className="space-y-2">
                                <StatRow label="Dependent files" value={result.impact?.impactedCount || 0} color="cyan" />
                                <StatRow label="Test files covering" value={result.impact?.testCount || 0} icon={result.impact?.testCount > 0 ? CheckCircle2 : AlertTriangle} iconColor={result.impact?.testCount > 0 ? 'text-emerald-400' : 'text-red-400'} />
                                <StatRow label="Graph status" value={result.impact?.stale ? 'Stale' : 'Current'} icon={result.impact?.stale ? AlertTriangle : CheckCircle2} iconColor={result.impact?.stale ? 'text-amber-400' : 'text-emerald-400'} />
                                <StatRow label="Centrality" value={result.compose?.graphify?.centrality || '—'} />
                            </div>
                            {result.impact?.topDependents?.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-white/[0.03]">
                                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">Nearest dependents</div>
                                    {result.impact.topDependents.map((d, i) => (
                                        <div key={i} className="text-[10px] text-slate-500 font-mono truncate border-l border-cyan-500/10 pl-2 py-0.5">{d}</div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* OpenSpec awareness */}
                        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <FileText size={14} className="text-amber-400" />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">OpenSpec — Intent</span>
                            </div>
                            <div className="space-y-2">
                                <StatRow label="Specs describing this file" value={result.compose?.openspec?.mentionedIn?.length || 0} color="amber" />
                            </div>
                            {result.compose?.openspec?.mentionedIn?.length > 0 ? (
                                <div className="mt-3 pt-3 border-t border-white/[0.03] space-y-1">
                                    {result.compose.openspec.mentionedIn.map((s, i) => (
                                        <div key={i} className="text-[10px] text-slate-400 font-mono flex items-center gap-2 border-l border-amber-500/10 pl-2 py-0.5">
                                            <FileText size={10} className="text-amber-400/60" />
                                            {s.spec}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="mt-3 pt-3 border-t border-white/[0.03] text-[10px] text-slate-600 italic">
                                    No OpenSpec specs describe this file yet.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Test coverage detail */}
                    {result.compose?.graphify?.testFiles?.length > 0 && (
                        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <Shield size={14} className="text-emerald-400" />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Test Coverage</span>
                            </div>
                            <div className="space-y-1">
                                {result.compose.graphify.testFiles.map((t, i) => (
                                    <div key={i} className="text-[10px] text-slate-400 font-mono border-l border-emerald-500/10 pl-2 py-0.5">{t}</div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {result?.error && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-xs text-red-400">
                    Analysis failed — ensure the workspace has a built knowledge graph and the file path is correct.
                </div>
            )}
        </div>
    );
}

function StatRow({ label, value, icon: Icon, iconColor, color }) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-white/[0.03] last:border-0">
            <span className="text-[10px] text-slate-500">{label}</span>
            <div className="flex items-center gap-1.5">
                {Icon && <Icon size={11} className={iconColor} />}
                <span className={`text-[10px] font-mono font-bold ${color === 'red' ? 'text-red-400' : color === 'amber' ? 'text-amber-400' : 'text-slate-300'}`}>{value}</span>
            </div>
        </div>
    );
}
