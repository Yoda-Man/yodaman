/**
 * ImpactAnalysisTab — dedicated impact analysis tool in Stardust.
 *
 * Enter any file path to get the full blast radius breakdown with:
 * - Graphify structural impact (dependents, centrality, test coverage)
 * - OpenSpec spec awareness (which specs describe this file)
 * - Configurable depth (1-4 hops)
 * - Workspace readiness badge
 *
 * Layout: the verdict and its numbers read as one banner across the top, then the
 * three file lists sit side by side. Every list is a column of paths, so they
 * gain from horizontal room rather than from being stacked in a narrow well.
 *
 * Data comes from /api/stardust/compose, which is the per-file endpoint. This tab
 * previously also called /api/stardust/change-impact/_any_ and read `risk`,
 * `impactedCount`, `testCount` and `topDependents` off the response — but that
 * route analyses an OpenSpec *change* by name, so "_any_" resolved to a change
 * that does not exist. It answered `{ deltaCount: 0, files: [] }` with none of
 * those fields present, which is why the verdict banner and the dependent list
 * were always blank no matter which file was entered.
 */

import React, { useState } from 'react';
import { Search, GitBranch, FileText, AlertTriangle, CheckCircle2, Shield, BarChart3, Brain } from 'lucide-react';

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
        const target = filePath.trim();
        if (!target) return;
        setLoading(true);
        try {
            // One call: compose already blends Graphify's blast radius with
            // OpenSpec's spec references for the same file, at the depth asked for.
            const params = new URLSearchParams({
                projectRoot: projectRoot || '',
                file: target,
                depth: String(depth),
                limit: '40',
            });
            const res = await fetch(`/api/stardust/compose?${params}`);
            const compose = await res.json();

            if (!res.ok || compose?.error) {
                setResult({ error: compose?.error || 'Analysis failed' });
                return;
            }
            setResult({ compose, analyzed: target });
        } catch (err) {
            setResult({ error: err.message });
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

            {/* Empty state — the three columns the results will occupy, labelled, so
                the full width reads as intentional rather than as a short box. */}
            {!result && !loading && (
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8">
                    <div className="text-center">
                        <BarChart3 size={28} className="text-slate-600 mx-auto mb-3" />
                        <p className="text-xs text-slate-500 mb-1">Impact analysis</p>
                        <p className="text-[10px] text-slate-600 max-w-lg mx-auto leading-relaxed">
                            Enter any file path to see its blast radius from the knowledge graph, which OpenSpec specs describe it, and whether tests cover the affected files. Adjust the hop depth to control how far the analysis reaches.
                        </p>
                    </div>
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                        {[
                            [GitBranch, 'text-cyan-400', 'Graphify — Structure', 'Dependents, centrality and how far the change reaches.'],
                            [FileText, 'text-amber-400', 'OpenSpec — Intent', 'Which specs describe this file, and what they promise.'],
                            [Shield, 'text-emerald-400', 'Test Coverage', 'The tests that exercise the affected files.'],
                            [Brain, 'text-purple-400', 'Context Expert — Relevance', 'The neighbours that rank closest, graph-weighted.'],
                        ].map(([Icon, color, title, hint]) => (
                            <div key={title} className="rounded-xl border border-white/[0.04] bg-black/20 px-4 py-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Icon size={13} className={`${color} opacity-50`} />
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">{title}</span>
                                </div>
                                <p className="text-[10px] text-slate-600 leading-relaxed">{hint}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Results */}
            {result?.compose && <Results result={result} depth={depth} />}

            {result?.error && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-xs text-red-400">
                    Analysis failed — ensure the workspace has a built knowledge graph and the file path is correct.
                    {typeof result.error === 'string' && <span className="block mt-1 font-mono text-[10px] opacity-70">{result.error}</span>}
                </div>
            )}
        </div>
    );
}

/**
 * The verdict banner plus the three tools' file lists.
 *
 * Split out of the form so the whole compose shape is destructured in one place,
 * rather than being reached through optional chains at every use.
 */
function Results({ result, depth }) {
    const { compose, analyzed } = result;
    const graphify = compose.graphify || {};
    const openspec = compose.openspec || {};
    const contextExpert = compose.contextExpert || {};

    const risk = graphify.risk || 'low';
    const RiskIcon = risk === 'low' ? CheckCircle2 : AlertTriangle;
    const riskIconColor = risk === 'high' ? 'text-red-400' : risk === 'moderate' ? 'text-amber-400' : 'text-emerald-400';

    // Graphify unavailable is the one case worth saying out loud: without a graph
    // there is no blast radius to report, and "0 dependents" would read as safe.
    if (!graphify.available) {
        return (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-6 flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                <div>
                    <h3 className="text-sm font-bold text-amber-200">No structural impact available</h3>
                    <p className="text-[11px] text-amber-200/70 mt-1 leading-relaxed">
                        {graphify.reason || 'Graphify has no graph for this workspace.'} Sync the repository from the sidebar, then run the analysis again.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Verdict and its numbers on one line — the summary a reviewer reads
                first, without having to scan two stacked panels. */}
            <div className={`rounded-2xl border p-5 ${(RISK_STYLES[risk] || RISK_STYLES.low).className}`}>
                <div className="flex flex-col xl:flex-row xl:items-center gap-5">
                    <div className="flex items-center gap-3 xl:w-72 shrink-0">
                        <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-white/[0.05] border border-white/10 shrink-0">
                            <RiskIcon size={24} className={riskIconColor} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-sm font-bold text-white capitalize">{risk} risk</h3>
                            <p className="text-[10px] text-slate-400 mt-0.5 truncate" title={compose.file || analyzed}>
                                {compose.file || analyzed}
                            </p>
                        </div>
                    </div>

                    <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
                        <Metric
                            label={`Dependents · ${depth} hop${depth > 1 ? 's' : ''}`}
                            value={graphify.blastRadius ?? 0}
                            tone="cyan"
                        />
                        <Metric
                            label="Tests covering"
                            value={graphify.testCount ?? 0}
                            tone={graphify.coveredByTests ? 'emerald' : 'red'}
                            icon={graphify.coveredByTests ? CheckCircle2 : AlertTriangle}
                        />
                        <Metric
                            label="Graph"
                            value={graphify.stale ? 'Stale' : 'Current'}
                            tone={graphify.stale ? 'amber' : 'emerald'}
                            icon={graphify.stale ? AlertTriangle : CheckCircle2}
                        />
                        <Metric label="Centrality" value={graphify.centrality ?? 0} tone="slate" />
                        <Metric label="Specs describing" value={openspec.mentionedIn?.length ?? 0} tone="amber" />
                    </div>
                </div>
            </div>

            {!graphify.inGraph && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 text-[11px] text-amber-200/80">
                    The graph has no node for <span className="font-mono">{compose.file}</span> — check the path is repo-relative. The numbers above are for a file the graph has never seen.
                </div>
            )}

            {/* All three tools' contributions side by side. Context Expert is
                included because compose already returns it graph-ranked — leaving it
                out was dropping a column the endpoint had already paid for. */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
                <ListPanel
                    icon={GitBranch}
                    iconColor="text-cyan-400"
                    accent="border-cyan-500/10"
                    title="Graphify — Structure"
                    caption={`Dependents within ${depth} hop${depth > 1 ? 's' : ''}`}
                    items={graphify.nearestDependents || []}
                    empty="Nothing in the graph depends on this file."
                />
                <ListPanel
                    icon={FileText}
                    iconColor="text-amber-400"
                    accent="border-amber-500/10"
                    title="OpenSpec — Intent"
                    caption="Specs that describe this file"
                    items={(openspec.mentionedIn || []).map(s => s.spec)}
                    empty={openspec.reason || 'No OpenSpec specs describe this file yet.'}
                />
                <ListPanel
                    icon={Shield}
                    iconColor="text-emerald-400"
                    accent="border-emerald-500/10"
                    title="Test Coverage"
                    caption="Tests reaching this file"
                    items={graphify.testFiles || []}
                    empty="No tests reach this file — a change here is unverified."
                />
                <ListPanel
                    icon={Brain}
                    iconColor="text-purple-400"
                    accent="border-purple-500/10"
                    title="Context Expert — Relevance"
                    caption={contextExpert.graphRanked
                        ? 'Neighbours, re-ranked with the graph'
                        : 'Semantic neighbours'}
                    items={(contextExpert.neighbours || []).map(n => `${n.file}  ·  ${Number(n.score || 0).toFixed(2)}`)}
                    empty={contextExpert.reason || 'No semantic neighbours found.'}
                />
            </div>
        </div>
    );
}

const METRIC_TONES = {
    cyan: 'text-cyan-300',
    emerald: 'text-emerald-300',
    amber: 'text-amber-300',
    red: 'text-red-300',
    slate: 'text-slate-300',
};

function Metric({ label, value, tone, icon: Icon }) {
    return (
        <div className="rounded-xl bg-black/25 border border-white/5 px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 truncate" title={label}>{label}</div>
            <div className="mt-1 flex items-center gap-1.5">
                {Icon && <Icon size={12} className={METRIC_TONES[tone] || METRIC_TONES.slate} />}
                <span className={`text-sm font-mono font-bold ${METRIC_TONES[tone] || METRIC_TONES.slate}`}>{value}</span>
            </div>
        </div>
    );
}

/**
 * One tool's contribution as a column of paths. Long paths keep their tail
 * visible on hover via title, and the list scrolls rather than pushing the
 * sibling columns out of alignment.
 */
function ListPanel({ icon: Icon, iconColor, accent, title, caption, items, empty }) {
    return (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                    <Icon size={14} className={`${iconColor} shrink-0`} />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 truncate">{title}</span>
                </div>
                <span className="text-[10px] font-mono font-bold text-slate-500 shrink-0">{items.length}</span>
            </div>
            <p className="text-[9px] text-slate-600 mb-3">{caption}</p>

            {items.length > 0 ? (
                <div className="space-y-0.5 max-h-72 overflow-y-auto custom-scrollbar">
                    {items.map((item, i) => (
                        <div
                            key={`${item}-${i}`}
                            title={item}
                            className={`text-[10px] text-slate-400 font-mono truncate border-l ${accent} pl-2 py-0.5`}
                        >
                            {item}
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-[10px] text-slate-600 italic">{empty}</p>
            )}
        </div>
    );
}
