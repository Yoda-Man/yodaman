/**
 * SearchTrace — why each search result ranked where it did.
 *
 * GraphRanker blends Context Expert's semantic score with Graphify's structure:
 *
 *   score = semantic × 0.6 + proximity × 0.25 + centrality × 0.15
 *
 * The bars here are the values the ranker actually used, read from the
 * `graphSignal` it attaches to every hit — so when the graph knows nothing about
 * the results, this tab says the ordering was semantic-only instead of drawing
 * three bars that had no effect.
 *
 * The active-file input is what makes proximity mean anything: without a file to
 * measure distance from, that term is zero for every hit. Setting it to the
 * focused file wires Compose's output into this tab's ranking.
 */

import React, { useState, useEffect } from 'react';
import {
    Search, Brain, GitBranch, Network, FileText, Crosshair, Info, Target, ArrowRight,
} from 'lucide-react';
import { api } from '../api/api';
import {
    Panel, EmptyState, Centered, Spinner, Label, Explainer, ErrorNote, SignalBar, StatTile,
} from './StardustKit';

function hitPath(hit) {
    if (typeof hit === 'string') return hit;
    return hit?.metadata?.path || hit?.path || hit?.file || '';
}

function hitSnippet(hit) {
    if (typeof hit === 'string') return '';
    return hit?.snippet || hit?.text || hit?.content || hit?.metadata?.snippet || '';
}

export default function SearchTrace({ projectRoot, focusFile, onOpenFile }) {
    const [query, setQuery] = useState('');
    const [activeFile, setActiveFile] = useState(focusFile || '');
    const [response, setResponse] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // A file focused elsewhere becomes the proximity origin here — that is
    // Graphify consuming what another tab selected.
    useEffect(() => {
        if (focusFile) setActiveFile(focusFile);
    }, [focusFile]);

    const handleSearch = async (e) => {
        e?.preventDefault();
        if (!query.trim()) return;
        setLoading(true);
        setError(null);
        try {
            setResponse(await api.searchTrace({
                query: query.trim(),
                projectRoot,
                activeFile: activeFile.trim() || undefined,
            }));
        } catch (err) {
            setError(err.message);
            setResponse(null);
        } finally {
            setLoading(false);
        }
    };

    const results = response?.results || [];
    const weights = response?.weights || { semantic: 0.6, proximity: 0.25, centrality: 0.15 };
    const graphRanked = Boolean(response?.graphRanked);
    const inGraphCount = results.filter(hit => hit?.graphSignal?.inGraph).length;

    return (
        <div className="space-y-4">
            {/* Query + proximity origin, full width */}
            <form onSubmit={handleSearch} className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,26rem)_auto] gap-2">
                <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search for anything, e.g. 'authentication middleware'"
                        className="w-full rounded-xl bg-black/35 border border-white/10 pl-9 pr-4 py-2.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                    />
                </div>
                <div className="relative">
                    <Crosshair size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        type="text"
                        value={activeFile}
                        onChange={e => setActiveFile(e.target.value)}
                        placeholder="Active file for proximity (optional)"
                        title="Results close to this file in the dependency graph rank higher. Leave empty and proximity contributes nothing."
                        className="w-full rounded-xl bg-black/35 border border-white/10 pl-9 pr-4 py-2.5 text-xs font-mono text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
                    />
                </div>
                <button
                    type="submit"
                    disabled={loading || !query.trim()}
                    className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-6 py-2.5 text-xs font-bold uppercase tracking-widest text-indigo-300 hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:text-white disabled:opacity-40 transition-all"
                >
                    {loading ? <Spinner size={14} className="text-indigo-300" /> : <Target size={14} />}
                    Trace
                </button>
            </form>

            {error && <ErrorNote>{error}</ErrorNote>}

            {loading && !response && <Panel title="Tracing" icon={Target} color="indigo"><Centered><Spinner /></Centered></Panel>}

            {!response && !loading && !error && (
                <Panel title="Ranking Trace" icon={Target} color="indigo">
                    <EmptyState
                        icon={Target}
                        title="Search trace explains the ordering"
                        hint="Every result carries three scores: semantic relevance from Context Expert, proximity to your active file in Graphify's dependency graph, and structural centrality. The blend decides the order, and this tab shows the values that produced it."
                    />
                </Panel>
            )}

            {response && (
                <>
                    {/* What actually drove this ordering */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                        <StatTile label="Results" value={results.length} hint={`mode: ${response.mode || 'code'}`} color="indigo" icon={Search} />
                        <StatTile
                            label="Ranking"
                            value={graphRanked ? 'Blended' : 'Semantic only'}
                            hint={graphRanked ? 'graph contributed' : 'graph had no matching hits'}
                            color={graphRanked ? 'emerald' : 'amber'}
                            icon={GitBranch}
                        />
                        <StatTile label="In graph" value={inGraphCount} hint={`of ${results.length} hits`} color="cyan" icon={Network} />
                        <StatTile
                            label="Proximity origin"
                            value={response.activeFile ? 'Set' : 'None'}
                            hint={response.activeFile || 'proximity scores 0'}
                            color={response.activeFile ? 'cyan' : 'slate'}
                            icon={Crosshair}
                        />
                    </div>

                    {/* Formula legend with the live weights */}
                    <div className="rounded-2xl border border-indigo-500/10 bg-indigo-500/[0.03] px-5 py-3 flex items-center gap-4 flex-wrap">
                        <Label color="text-indigo-400">Ranking formula</Label>
                        <div className="flex items-center gap-3 text-[10px] font-mono flex-wrap">
                            <span className="flex items-center gap-1.5"><Brain size={11} className="text-purple-400" /><span className="text-purple-400">semantic × {weights.semantic}</span></span>
                            <span className="text-slate-600">+</span>
                            <span className="flex items-center gap-1.5"><GitBranch size={11} className="text-cyan-400" /><span className="text-cyan-400">proximity × {weights.proximity}</span></span>
                            <span className="text-slate-600">+</span>
                            <span className="flex items-center gap-1.5"><Network size={11} className="text-amber-400" /><span className="text-amber-400">centrality × {weights.centrality}</span></span>
                        </div>
                        {!graphRanked && (
                            <span className="ml-auto text-[10px] text-amber-400/90">
                                Not applied to this query — the graph matched none of these hits.
                            </span>
                        )}
                    </div>

                    <Panel title={`Results (${results.length})`} icon={FileText} color="indigo">
                        {results.length === 0 ? (
                            <EmptyState
                                compact
                                icon={Search}
                                title="No results"
                                hint="Context Expert returned nothing for this query. If the workspace was indexed recently, try a broader phrase."
                            />
                        ) : (
                            <div className="space-y-2">
                                {results.map((hit, i) => (
                                    <ResultRow
                                        key={`${hitPath(hit)}-${i}`}
                                        rank={i + 1}
                                        hit={hit}
                                        weights={weights}
                                        onOpenFile={onOpenFile}
                                    />
                                ))}
                            </div>
                        )}
                    </Panel>

                    <Explainer title="Reading the bars" icon={Info}>
                        <p><b className="text-purple-400">Semantic ({weights.semantic}):</b> how well the file's embedding matches the query, normalized across this result set. Context Expert computes it from indexed chunks.</p>
                        <p><b className="text-cyan-400">Proximity ({weights.proximity}):</b> hops from the active file through Graphify's dependency graph, decaying to zero at three hops. With no active file this term is zero for everything.</p>
                        <p><b className="text-amber-400">Centrality ({weights.centrality}):</b> how connected the file is, relative to the busiest file in the graph. Weighted lowest on purpose — a hub is otherwise relevant to every query.</p>
                        <p className="text-slate-600">Reranking is advisory. With no graph, or no graph coverage of the hits, Context Expert's original order is returned untouched and this tab says so rather than implying structure was applied.</p>
                    </Explainer>
                </>
            )}
        </div>
    );
}

function ResultRow({ rank, hit, weights, onOpenFile }) {
    const file = hitPath(hit);
    const signal = hit?.graphSignal || null;
    const snippet = hitSnippet(hit);

    return (
        <div className="rounded-xl border border-white/5 bg-black/25 px-4 py-3 hover:border-white/10 transition-colors">
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(0,22rem)] gap-4 items-start">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">#{rank}</span>
                        <FileText size={11} className="shrink-0 text-slate-500" />
                        <span className="font-mono text-xs text-white truncate" title={file}>{file || '(unnamed result)'}</span>
                        {signal && !signal.inGraph && (
                            <span className="shrink-0 rounded border border-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-600">
                                not in graph
                            </span>
                        )}
                        {hit?.graphRank !== undefined && (
                            <span className="ml-auto shrink-0 font-mono text-[10px] text-indigo-400" title="Blended score used for ordering">
                                {hit.graphRank.toFixed(3)}
                            </span>
                        )}
                    </div>

                    {snippet && (
                        <pre className="mt-1.5 max-h-24 overflow-hidden rounded-lg bg-black/40 border border-white/5 px-3 py-2 font-mono text-[10px] leading-relaxed text-slate-500 whitespace-pre-wrap break-all">
                            {String(snippet).slice(0, 400)}
                        </pre>
                    )}

                    {file && onOpenFile && (
                        <button
                            type="button"
                            onClick={() => onOpenFile(file)}
                            className="group mt-2 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:text-indigo-300 transition-colors"
                        >
                            Compose this file
                            <ArrowRight size={10} className="group-hover:translate-x-0.5 transition-transform" />
                        </button>
                    )}
                </div>

                {/* The signals that placed it here */}
                <div className="space-y-1">
                    {signal ? (
                        <>
                            <SignalBar label="Semantic" value={signal.semantic} weight={weights.semantic} color="purple" />
                            <SignalBar label="Proximity" value={signal.proximity} weight={weights.proximity} color="cyan" />
                            <SignalBar label="Central" value={signal.centrality} weight={weights.centrality} color="amber" />
                            <div className="pt-0.5 text-[9px] text-slate-600">
                                {signal.hops === null || signal.hops === undefined
                                    ? 'no proximity origin set'
                                    : signal.hops === 0
                                        ? 'this is the active file'
                                        : `${signal.hops} hop${signal.hops === 1 ? '' : 's'} from the active file`}
                            </div>
                        </>
                    ) : (
                        <div className="text-[10px] text-slate-600 leading-relaxed">
                            No graph signal — this result kept Context Expert's original position.
                            {hit?.score !== undefined && (
                                <span className="block mt-1 font-mono text-slate-500">raw score {Number(hit.score).toFixed(3)}</span>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
