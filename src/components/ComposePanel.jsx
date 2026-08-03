/**
 * ComposePanel — file-centric cross-reference combining all three mandatory tools.
 *
 * For a given file, shows:
 *   🔵 OpenSpec: which specs describe this file (intent)
 *   🟢 Graphify: dependents, centrality, blast radius, test coverage (structure)
 *   🟣 Context Expert: semantic search relevance insight (context)
 *
 * This makes the "three tools composing" claim tangible in the UI.
 */

import React, { useState } from 'react';
import { Search, FileText, GitBranch, Brain, Link2, Shield, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../api/api';

export default function ComposePanel({ projectRoot }) {
    const [query, setQuery] = useState('');
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleCompose = async (e) => {
        e?.preventDefault();
        if (!query.trim()) return;
        setLoading(true);
        setError(null);
        try {
            const url = new URL(`${window.location.origin}/api/stardust/compose`);
            url.searchParams.append('projectRoot', projectRoot || '');
            url.searchParams.append('file', query.trim());
            const res = await fetch(url);
            const data = await res.json();
            setResult(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Search bar */}
            <form onSubmit={handleCompose} className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Enter a file path, e.g. backend/interfaces/RestController.js"
                        className="w-full rounded-xl bg-black/35 border border-white/10 pl-9 pr-4 py-2.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors font-mono"
                    />
                </div>
                <button
                    type="submit"
                    disabled={loading || !query.trim()}
                    className="shrink-0 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-indigo-300 hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:text-white disabled:opacity-40 transition-all"
                >
                    {loading ? (
                        <div className="animate-spin h-4 w-4 border-2 border-indigo-400 border-t-transparent rounded-full" />
                    ) : (
                        'Compose'
                    )}
                </button>
            </form>

            {/* Error */}
            {error && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-xs text-red-400">{error}</div>
            )}

            {/* Empty state */}
            {!result && !loading && (
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center">
                    <Link2 size={28} className="text-slate-600 mx-auto mb-3" />
                    <p className="text-xs text-slate-500 mb-1">Cross-reference any file across all three tools</p>
                    <p className="text-[10px] text-slate-600 max-w-md mx-auto">
                        Enter a repo-relative path to see which OpenSpec specs describe it, its Graphify structural position (dependents, centrality, blast radius), and the Context Expert relevance signal.
                    </p>
                </div>
            )}

            {/* Result */}
            {result && (
                <div className="space-y-4">
                    {/* File header */}
                    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <FileText size={16} className="text-slate-400" />
                            <h3 className="text-sm font-mono text-white">{result.file}</h3>
                        </div>
                        {!result.available && (
                            <div className="flex items-center gap-2 text-xs text-amber-400">
                                <AlertTriangle size={12} />
                                No knowledge graph built for this workspace. Run a sync to populate structural data.
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* ── OpenSpec column ── */}
                        <ColumnCard
                            icon={FileText}
                            label="OpenSpec — Intent"
                            color="amber"
                            metric={`${result.openspec.mentionedIn.length} spec${result.openspec.mentionedIn.length !== 1 ? 's' : ''}`}
                            metricLabel="mention this file"
                            emptyText="No specs describe this file yet"
                        >
                            {result.openspec.mentionedIn.map((s, i) => (
                                <div key={i} className="flex items-center gap-2 text-[11px] rounded-lg bg-amber-500/[0.04] border border-amber-500/10 px-3 py-2">
                                    <FileText size={12} className="text-amber-400 shrink-0" />
                                    <span className="text-slate-300 font-mono">{s.spec}</span>
                                </div>
                            ))}
                        </ColumnCard>

                        {/* ── Graphify column ── */}
                        <ColumnCard
                            icon={GitBranch}
                            label="Graphify — Structure"
                            color="cyan"
                            metric={result.graphify.dependents}
                            metricLabel="dependents"
                            emptyText="No structural data available"
                        >
                            <StatRow label="Dependents" value={result.graphify.dependents} color="cyan" />
                            <StatRow label="Centrality" value={result.graphify.centrality} color="cyan" />
                            <StatRow
                                label="Blast radius"
                                value={result.graphify.blastRadius > 0 ? `${result.graphify.blastRadius} files` : 'None'}
                                icon={result.graphify.blastRadius >= 5 ? AlertTriangle : CheckCircle2}
                                iconColor={result.graphify.blastRadius >= 5 ? 'text-red-400' : 'text-emerald-400'}
                                color={result.graphify.blastRadius >= 5 ? 'red' : 'emerald'}
                            />
                            <StatRow
                                label="Test coverage"
                                value={result.graphify.coveredByTests ? 'Yes' : 'No'}
                                icon={result.graphify.coveredByTests ? CheckCircle2 : AlertTriangle}
                                iconColor={result.graphify.coveredByTests ? 'text-emerald-400' : 'text-red-400'}
                                color={result.graphify.coveredByTests ? 'emerald' : 'red'}
                            />
                            {result.graphify.nearestDependents.length > 0 && (
                                <div className="mt-2">
                                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">Nearest dependents</div>
                                    {result.graphify.nearestDependents.map((d, i) => (
                                        <div key={i} className="text-[10px] text-slate-500 font-mono truncate ml-1 border-l border-white/5 pl-2 py-0.5">{d}</div>
                                    ))}
                                </div>
                            )}
                            {result.graphify.testFiles.length > 0 && (
                                <div className="mt-2">
                                    <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-600 mb-1.5">Covering tests</div>
                                    {result.graphify.testFiles.map((t, i) => (
                                        <div key={i} className="text-[10px] text-slate-500 font-mono truncate ml-1 border-l border-emerald-500/10 pl-2 py-0.5">{t}</div>
                                    ))}
                                </div>
                            )}
                        </ColumnCard>

                        {/* ── Context Expert column ── */}
                        <ColumnCard
                            icon={Brain}
                            label="Context Expert — Relevance"
                            color="indigo"
                            metric="—"
                            metricLabel="semantic context"
                            emptyText="Use semantic search to populate"
                        >
                            <div className="text-[10px] text-slate-500 leading-relaxed">
                                Context Expert indexes this file for semantic search. Its embedding determines how strongly the file matches natural-language queries. The GraphRanker blends this semantic score (weight 0.6) with graph proximity (0.25) and centrality (0.15) to order search results.
                            </div>
                            <div className="mt-3 rounded-lg bg-indigo-500/[0.04] border border-indigo-500/10 px-3 py-2">
                                <div className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 mb-1">Ranking formula</div>
                                <div className="text-[10px] text-slate-400 font-mono">
                                    score = semantic × 0.6 + proximity × 0.25 + centrality × 0.15
                                </div>
                            </div>
                        </ColumnCard>
                    </div>
                </div>
            )}
        </div>
    );
}

function ColumnCard({ icon: Icon, label, color, metric, metricLabel, emptyText, children }) {
    const borderColor = {
        amber: 'border-amber-500/10',
        cyan: 'border-cyan-500/10',
        indigo: 'border-indigo-500/10',
    };
    return (
        <div className={`rounded-2xl border ${borderColor[color] || 'border-white/5'} bg-white/[0.02] p-4`}>
            <div className="flex items-center gap-2 mb-3">
                <Icon size={14} className={color === 'amber' ? 'text-amber-400' : color === 'cyan' ? 'text-cyan-400' : 'text-indigo-400'} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
            </div>
            <div className="flex items-baseline gap-1.5 mb-3">
                <span className="text-2xl font-bold text-white">{metric}</span>
                <span className="text-[10px] text-slate-500">{metricLabel}</span>
            </div>
            {children || (
                <div className="text-[10px] text-slate-600 italic">{emptyText}</div>
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
                <span className={`text-[10px] font-mono font-bold ${
                    color === 'red' ? 'text-red-400' : color === 'emerald' ? 'text-emerald-400' : 'text-slate-300'
                }`}>{value}</span>
            </div>
        </div>
    );
}
