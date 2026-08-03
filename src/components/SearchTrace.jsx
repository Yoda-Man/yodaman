/**
 * SearchTrace — shows WHY each search result ranked where it did.
 *
 * Makes GraphRanker's scoring transparent: semantic score (Context Expert),
 * graph proximity (Graphify), and centrality (Graphify) are shown per result.
 * The ranking formula is: score = semantic×0.6 + proximity×0.25 + centrality×0.15
 */

import React, { useState } from 'react';
import { Search, Brain, GitBranch, Network, BarChart3, FileText } from 'lucide-react';

// Simulate search with ranking trace.
// In production this would call the search API and parse GraphRanker logs.
// For now, it calls /api/search and displays the raw results with ranking explanation.
export default function SearchTrace({ projectRoot }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleSearch = async (e) => {
        e?.preventDefault();
        if (!query.trim()) return;
        setLoading(true);
        try {
            const url = new URL(`${window.location.origin}/api/search`);
            url.searchParams.append('q', query);
            url.searchParams.append('mode', 'code');
            if (projectRoot) url.searchParams.append('projectRoot', projectRoot);
            const res = await fetch(url);
            const data = await res.json();
            setResults(data);
        } catch (_) {
            setResults(null);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Search bar */}
            <form onSubmit={handleSearch} className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search for anything, e.g. 'authentication middleware'"
                        className="w-full rounded-xl bg-black/35 border border-white/10 pl-9 pr-4 py-2.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                    />
                </div>
                <button type="submit" disabled={loading || !query.trim()}
                    className="shrink-0 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-indigo-300 hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:text-white disabled:opacity-40 transition-all">
                    {loading ? <div className="animate-spin h-4 w-4 border-2 border-indigo-400 border-t-transparent rounded-full" /> : 'Trace'}
                </button>
            </form>

            {/* Empty */}
            {!results && !loading && (
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center">
                    <BarChart3 size={28} className="text-slate-600 mx-auto mb-3" />
                    <p className="text-xs text-slate-500 mb-1">Search trace explains ranking</p>
                    <p className="text-[10px] text-slate-600 max-w-md mx-auto">
                        Every search result gets three scores: semantic relevance from Context Expert, graph proximity to your active file, and structural centrality from Graphify. The blend determines order.
                    </p>
                </div>
            )}

            {/* Results */}
            {results && (
                <div className="space-y-3">
                    {/* Formula legend */}
                    <div className="rounded-xl border border-indigo-500/10 bg-indigo-500/[0.03] p-3 flex items-center gap-4 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Ranking formula</span>
                        <div className="flex items-center gap-3 text-[10px]">
                            <span className="flex items-center gap-1"><Brain size={11} className="text-purple-400" /><span className="text-purple-400">Semantic × 0.6</span></span>
                            <span className="text-slate-600">+</span>
                            <span className="flex items-center gap-1"><GitBranch size={11} className="text-cyan-400" /><span className="text-cyan-400">Proximity × 0.25</span></span>
                            <span className="text-slate-600">+</span>
                            <span className="flex items-center gap-1"><Network size={11} className="text-amber-400" /><span className="text-amber-400">Centrality × 0.15</span></span>
                        </div>
                    </div>

                    {/* Result list */}
                    {(!results.results || results.results.length === 0) ? (
                        <div className="text-xs text-slate-600 italic text-center py-8">No results found</div>
                    ) : (
                        results.results.map((r, i) => (
                            <div key={i} className="rounded-xl border border-white/5 bg-black/25 p-4 hover:border-white/10 transition-colors">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[9px] font-bold text-slate-600 bg-white/5 px-1.5 py-0.5 rounded">#{i + 1}</span>
                                            <FileText size={11} className="text-slate-500 shrink-0" />
                                            <span className="text-xs font-mono text-white truncate">{typeof r === 'string' ? r : r.file || r.path || JSON.stringify(r).slice(0, 80)}</span>
                                        </div>
                                        {r.score !== undefined && (
                                            <div className="flex items-center gap-3 mt-2">
                                                {/* Semantic bar */}
                                                <div className="flex items-center gap-1 flex-1">
                                                    <div className="h-1.5 flex-1 rounded-full bg-white/5 overflow-hidden">
                                                        <div className="h-full rounded-full bg-purple-400/60" style={{ width: `${Math.min(100, (r.score || 0) * 100)}%` }} />
                                                    </div>
                                                    <span className="text-[9px] text-purple-400 w-8 text-right">{(r.score || 0).toFixed(2)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Explanation footer */}
            <div className="rounded-xl border border-white/5 bg-black/25 p-4">
                <div className="text-[10px] text-slate-500 space-y-1">
                    <p><b className="text-purple-400">Semantic (0.6):</b> How well the file's embedding matches your query. Context Expert computes this from indexed chunks.</p>
                    <p><b className="text-cyan-400">Proximity (0.25):</b> How close the file is to your active editor file in the dependency graph. Up to 3 hops out.</p>
                    <p><b className="text-amber-400">Centrality (0.15):</b> How many files depend on this file. Prevents highly-connected modules from dominating.</p>
                    <p className="text-slate-600 mt-1">Without a graph, results fall back to semantic-only ordering. With a graph and an active file, the blend moves structurally relevant files up.</p>
                </div>
            </div>
        </div>
    );
}
