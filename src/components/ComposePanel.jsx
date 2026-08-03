/**
 * ComposePanel — one file, seen through all three tools at once.
 *
 *   🟡 OpenSpec       — which specs describe this file (intent)
 *   🔵 Graphify       — dependents, centrality, blast radius, tests (structure)
 *   🟣 Context Expert — the file's own semantic neighbours (context)
 *
 * The third column used to be a paragraph explaining what Context Expert would
 * do. It now runs the search and shows the hits, each carrying the graph signal
 * that ranked it — so the column is Context Expert output already blended with
 * Graphify, which is the composition the whole tab is claiming.
 *
 * Every file listed in any column is itself clickable, so following a dependency
 * chain across the three tools never means retyping a path.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    Search, FileText, FileQuestion, GitBranch, Brain, Link2, AlertTriangle,
    CheckCircle2, Network, Crosshair, ShieldAlert, Info, XCircle,
} from 'lucide-react';
import { api } from '../api/api';
import {
    Panel, StatTile, FileChip, EmptyState, Centered, Spinner, Label,
    Explainer, ErrorNote, StatRow, SignalBar,
} from './StardustKit';

const RISK_COLORS = { high: 'red', moderate: 'amber', low: 'emerald' };

export default function ComposePanel({ projectRoot, focusFile, onOpenFile }) {
    const [query, setQuery] = useState(focusFile || '');
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const compose = useCallback(async (file) => {
        const target = String(file || '').trim();
        if (!target) return;
        setLoading(true);
        setError(null);
        try {
            setResult(await api.stardustCompose(projectRoot, target));
        } catch (err) {
            setError(err.message);
            setResult(null);
        } finally {
            setLoading(false);
        }
    }, [projectRoot]);

    // A file handed over from Drift, Trace or the Board composes on arrival —
    // the handoff is the point, so it must not need a second click here.
    useEffect(() => {
        if (!focusFile) return;
        setQuery(focusFile);
        compose(focusFile);
    }, [focusFile, compose]);

    const handleSubmit = (e) => {
        e?.preventDefault();
        compose(query);
    };

    return (
        <div className="space-y-4">
            {/* Search bar — full width, it is the entry point for the whole tab */}
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Repo-relative file path, e.g. backend/interfaces/RestController.js"
                        className="w-full rounded-xl bg-black/35 border border-white/10 pl-9 pr-4 py-2.5 text-xs font-mono text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                    />
                </div>
                <button
                    type="submit"
                    disabled={loading || !query.trim()}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-indigo-300 hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:text-white disabled:opacity-40 transition-all"
                >
                    {loading ? <Spinner size={14} className="text-indigo-300" /> : <Link2 size={14} />}
                    Compose
                </button>
            </form>

            {error && <ErrorNote>{error}</ErrorNote>}

            {!result && !loading && !error && (
                <Panel title="Cross-Tool Reference" icon={Link2} color="indigo">
                    <EmptyState
                        icon={Link2}
                        title="Cross-reference any file across all three tools"
                        hint="Enter a repo-relative path to see which OpenSpec specs describe it, its Graphify structural position — dependents, centrality, blast radius, test coverage — and the Context Expert neighbours that rank closest to it."
                    />
                </Panel>
            )}

            {loading && !result && <Panel title="Composing" icon={Link2} color="indigo"><Centered><Spinner /></Centered></Panel>}

            {result && <ComposeResult result={result} onOpenFile={onOpenFile} loading={loading} />}
        </div>
    );
}

function ComposeResult({ result, onOpenFile, loading }) {
    const { openspec, graphify, contextExpert } = result;
    const risk = graphify.risk || 'low';

    return (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
            {/* File header + the headline numbers from each tool */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-5 py-4">
                <div className="flex items-center gap-2.5 mb-3">
                    <Crosshair size={16} className="shrink-0 text-indigo-400" />
                    <h3 className="text-sm font-mono text-white truncate">{result.file}</h3>
                    {graphify.stale && (
                        <span className="shrink-0 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-400">
                            graph stale
                        </span>
                    )}
                    {graphify.available && !graphify.inGraph && (
                        <span className="shrink-0 rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-red-400">
                            not in graph
                        </span>
                    )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                    <StatTile label="Specs" value={openspec.mentionedIn.length} hint={`of ${openspec.specCount}`} color="amber" icon={FileText} />
                    <StatTile label="Dependents" value={graphify.dependents} hint="import this" color="cyan" icon={GitBranch} />
                    <StatTile label="Blast radius" value={graphify.blastRadius} hint="files reached" color={graphify.blastRadius >= 5 ? 'red' : 'cyan'} icon={Network} />
                    <StatTile label="Centrality" value={graphify.centrality} hint="graph edges" color="cyan" icon={Network} />
                    <StatTile
                        label="Tests"
                        value={graphify.coveredByTests ? graphify.testFiles.length || 'Yes' : 'None'}
                        hint={graphify.coveredByTests ? 'covering' : 'no safety net'}
                        color={graphify.coveredByTests ? 'emerald' : 'red'}
                        icon={graphify.coveredByTests ? CheckCircle2 : AlertTriangle}
                    />
                    <StatTile label="Risk" value={risk} color={RISK_COLORS[risk] || 'slate'} icon={ShieldAlert} />
                </div>
            </div>

            {/* The three tools, one column each, filling the screen */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
                {/* ── OpenSpec ── */}
                <Panel title="OpenSpec — Intent" icon={FileText} color="amber" fill>
                    {!openspec.available ? (
                        <Unavailable reason={openspec.reason || 'OpenSpec has nothing to say about this workspace yet'} />
                    ) : openspec.mentionedIn.length === 0 ? (
                        <EmptyState
                            compact
                            icon={FileQuestion}
                            title="No spec describes this file"
                            hint={`${openspec.specCount} spec${openspec.specCount === 1 ? '' : 's'} were searched. A file with dependents and no recorded intent is exactly what the Drift tab flags as undocumented.`}
                        />
                    ) : (
                        <div className="space-y-1.5">
                            <p className="text-[10px] text-slate-500 mb-2 leading-relaxed">
                                Specs that cite this file. These are the statements of intent that must stay true.
                            </p>
                            {openspec.mentionedIn.map((entry, i) => (
                                <div key={`${entry.spec}-${i}`} className="rounded-lg border border-amber-500/10 bg-amber-500/[0.04] px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        <FileText size={11} className="shrink-0 text-amber-400" />
                                        <span className="font-mono text-[11px] text-slate-300 truncate">{entry.spec}</span>
                                    </div>
                                    {entry.references?.length > 0 && (
                                        <div className="mt-1 pl-[19px] text-[10px] text-slate-600 truncate">
                                            cites <span className="font-mono text-slate-500">{entry.references.join(', ')}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </Panel>

                {/* ── Graphify ── */}
                <Panel title="Graphify — Structure" icon={GitBranch} color="cyan" fill>
                    {!graphify.available ? (
                        <Unavailable reason={graphify.reason || 'no knowledge graph has been built for this workspace yet'} />
                    ) : (
                        <div className="space-y-3">
                            <div>
                                <StatRow label="Dependents" value={graphify.dependents} color="cyan" />
                                <StatRow label="Centrality (graph edges)" value={graphify.centrality} color="cyan" />
                                <StatRow
                                    label="Blast radius (2 hops)"
                                    value={graphify.blastRadius > 0 ? `${graphify.blastRadius} files` : 'none'}
                                    icon={graphify.blastRadius >= 5 ? AlertTriangle : CheckCircle2}
                                    color={graphify.blastRadius >= 5 ? 'red' : 'emerald'}
                                />
                                <StatRow
                                    label="Test coverage"
                                    value={graphify.coveredByTests ? 'covered' : 'none'}
                                    icon={graphify.coveredByTests ? CheckCircle2 : AlertTriangle}
                                    color={graphify.coveredByTests ? 'emerald' : 'red'}
                                />
                                <StatRow label="Risk" value={risk} color={RISK_COLORS[risk] || 'slate'} />
                            </div>

                            {graphify.reason && (
                                <p className="text-[10px] text-amber-400/80 leading-relaxed">{graphify.reason}</p>
                            )}

                            {graphify.nearestDependents.length > 0 && (
                                <div>
                                    <Label className="block mb-1.5">Nearest dependents</Label>
                                    <div className="space-y-0.5">
                                        {graphify.nearestDependents.map((file, i) => (
                                            <FileChip key={`${file}-${i}`} file={file} color="cyan" onOpen={onOpenFile} />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {graphify.testFiles.length > 0 && (
                                <div>
                                    <Label color="text-emerald-500" className="block mb-1.5">Covering tests</Label>
                                    <div className="space-y-0.5">
                                        {graphify.testFiles.map((file, i) => (
                                            <FileChip key={`${file}-${i}`} file={file} color="emerald" onOpen={onOpenFile} />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </Panel>

                {/* ── Context Expert ── */}
                <Panel title="Context Expert — Relevance" icon={Brain} color="purple" fill>
                    {!contextExpert.available ? (
                        <Unavailable reason={contextExpert.reason || 'Context Expert returned no hits for this file'} />
                    ) : (
                        <div className="space-y-3">
                            <p className="text-[10px] text-slate-500 leading-relaxed">
                                Files Context Expert ranks closest to this one, reordered by Graphify. Each bar is the actual
                                signal that placed it here — not the weights restated.
                            </p>
                            {!contextExpert.graphRanked && (
                                <div className="rounded-lg border border-amber-500/10 bg-amber-500/[0.04] px-3 py-2 text-[10px] text-amber-400/90 leading-relaxed">
                                    Ranked on semantic score alone — the graph knows none of these hits, so structure could
                                    not contribute.
                                </div>
                            )}
                            <div className="space-y-2">
                                {contextExpert.neighbours.map((hit, i) => (
                                    <div key={`${hit.file}-${i}`} className="rounded-lg border border-purple-500/10 bg-purple-500/[0.03] px-3 py-2">
                                        <FileChip file={hit.file} color="purple" onOpen={onOpenFile} trailing={`#${i + 1}`} />
                                        {hit.signal && (
                                            <div className="mt-1.5 space-y-1 px-1">
                                                <SignalBar label="Semantic" value={hit.signal.semantic} weight={hit.signal.weights?.semantic} color="purple" />
                                                <SignalBar label="Proximity" value={hit.signal.proximity} weight={hit.signal.weights?.proximity} color="cyan" />
                                                <SignalBar label="Central" value={hit.signal.centrality} weight={hit.signal.weights?.centrality} color="amber" />
                                                {hit.signal.hops !== null && hit.signal.hops !== undefined && (
                                                    <div className="text-[9px] text-slate-600 pt-0.5">
                                                        {hit.signal.hops === 0 ? 'same file in the graph' : `${hit.signal.hops} hop${hit.signal.hops === 1 ? '' : 's'} away in the dependency graph`}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </Panel>
            </div>

            <Explainer title="What composing actually does" icon={Info}>
                <p><b className="text-slate-400">One request, three tools.</b> The columns are not three independent lookups stitched together in the browser — the server asks OpenSpec, Graphify and Context Expert for this one file and returns their combined answer.</p>
                <p><b className="text-slate-400">Context Expert's hits arrive pre-ranked by Graphify.</b> The semantic search runs with this file as the active file, so proximity in the dependency graph moves structurally related results up. That is Graphify consuming Context Expert's output.</p>
                <p><b className="text-slate-400">Each tool fails alone.</b> A missing graph empties one column and leaves the other two intact.</p>
            </Explainer>
        </div>
    );
}

function Unavailable({ reason }) {
    return (
        <div className="flex items-start gap-2 py-2">
            <XCircle size={13} className="shrink-0 mt-0.5 text-slate-600" />
            <p className="text-[10px] text-slate-500 leading-relaxed">{reason}</p>
        </div>
    );
}
