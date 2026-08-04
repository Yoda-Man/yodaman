/**
 * SpecDriftPanel — architecture-vs-intent drift detection UI.
 *
 * OpenSpec holds the system you said you would build; Graphify holds the one you
 * did. This is the only reading in Stardust that needs both, so it is where the
 * three-tool requirement pays for itself:
 *
 *   staleReferences — a spec cites a file the graph has never seen
 *   undocumented    — a load-bearing module no spec describes
 *
 * Both lists are handoffs, not read-outs: every file opens in Compose, where its
 * specs, structure and semantic neighbours are shown together.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    AlertTriangle, FileQuestion, RefreshCw, CheckCircle2, GitCompare,
    FileText, GitBranch, Layers, ShieldAlert, Info,
} from 'lucide-react';
import { api } from '../api/api';
import {
    Panel, StatTile, FileChip, EmptyState, Centered, Spinner, Label, Explainer, GhostButton,
} from './StardustKit';

export default function SpecDriftPanel({ projectRoot, drift, loading: externalLoading, onRefresh, onOpenFile }) {
    // The pipeline strip already fetched drift for this workspace; only fetch when
    // rendered without it, so the tab never duplicates a request it can inherit.
    const [ownReport, setOwnReport] = useState(null);
    const [ownLoading, setOwnLoading] = useState(false);
    const [minDependents, setMinDependents] = useState(2);

    const inherited = drift !== undefined && minDependents === 2;
    const report = inherited ? drift : ownReport;
    const loading = inherited ? Boolean(externalLoading) : ownLoading;

    const fetchDrift = useCallback(async (threshold) => {
        if (!projectRoot) return;
        setOwnLoading(true);
        try {
            setOwnReport(await api.stardustDrift(projectRoot, { minDependents: threshold }));
        } catch (_) {
            setOwnReport(null);
        } finally {
            setOwnLoading(false);
        }
    }, [projectRoot]);

    // Fetch when the threshold moves off the inherited default, or when this panel
    // is rendered without an inherited report at all.
    useEffect(() => {
        if (minDependents !== 2 || drift === undefined) fetchDrift(minDependents);
    }, [minDependents, drift, fetchDrift]);

    const refresh = () => {
        if (inherited) onRefresh?.();
        else fetchDrift(minDependents);
    };

    const refreshButton = (
        <GhostButton icon={RefreshCw} label="Recheck" color="indigo" loading={loading} onClick={refresh} />
    );

    if (loading && !report) {
        return <Panel title="Architecture Drift" icon={GitCompare} color="amber"><Centered><Spinner /></Centered></Panel>;
    }

    if (!report) {
        return (
            <Panel title="Architecture Drift" icon={GitCompare} color="amber" action={refreshButton}>
                <EmptyState
                    icon={GitCompare}
                    title="Drift analysis unavailable"
                    hint="Drift compares OpenSpec's intent against Graphify's structure. Both are needed: initialize OpenSpec and build a knowledge graph, then recheck."
                />
            </Panel>
        );
    }

    if (!report.available) {
        return (
            <div className="space-y-4">
                <Panel title="Architecture Drift" icon={GitCompare} color="amber" action={refreshButton}>
                    <EmptyState
                        icon={AlertTriangle}
                        title={report.reason}
                        hint="Drift needs both sides of the comparison. Once specs exist and a graph has been built, this tab reports which specs have gone out of date and which load-bearing modules nothing describes."
                    />
                </Panel>
                <Explainer title="Why this needs all three tools" icon={Info}>
                    <p><b className="text-slate-400">A graph-only tool has no notion of intent.</b> It can tell you a module is central; it cannot tell you whether that was the plan.</p>
                    <p><b className="text-slate-400">A spec-only tool has no notion of reality.</b> It can tell you what was promised; it cannot tell you the file was renamed three weeks ago.</p>
                </Explainer>
            </div>
        );
    }

    const { staleReferences, undocumented, inSync, specCount, graphFileCount, documentedFiles, staleCount, undocumentedCount } = report;
    const coverage = graphFileCount > 0 ? Math.round((documentedFiles / graphFileCount) * 100) : 0;

    return (
        <div className="space-y-4">
            {/* Verdict + the counts behind it, across the full width */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                <div className={`sm:col-span-2 xl:col-span-1 rounded-2xl border px-4 py-3 flex items-center gap-3 ${
                    inSync ? 'border-emerald-500/20 bg-emerald-500/[0.05]' : 'border-amber-500/20 bg-amber-500/[0.05]'
                }`}>
                    {inSync
                        ? <CheckCircle2 size={20} className="shrink-0 text-emerald-400" />
                        : <AlertTriangle size={20} className="shrink-0 text-amber-400" />}
                    <div className="min-w-0">
                        <div className={`text-xs font-bold ${inSync ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {inSync ? 'Specs agree with code' : 'Drift detected'}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                            {inSync ? 'nothing to reconcile' : `${staleCount} stale · ${undocumentedCount} undocumented`}
                        </div>
                    </div>
                </div>
                <StatTile label="Specs" value={specCount} hint="written" color="amber" icon={FileText} />
                <StatTile label="Graph files" value={graphFileCount} hint="tracked" color="cyan" icon={GitBranch} />
                <StatTile label="Documented" value={documentedFiles} hint={`${coverage}% of graph`} color="emerald" icon={Layers} />
                <StatTile
                    label="Stale references"
                    value={staleCount}
                    hint={staleCount === 0 ? 'none' : 'specs are lying'}
                    color={staleCount === 0 ? 'emerald' : 'red'}
                    icon={ShieldAlert}
                />
            </div>

            {/* The two findings side by side — each fills half the screen */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                <Panel
                    title={`Stale References (${staleCount})`}
                    icon={ShieldAlert}
                    color={staleCount > 0 ? 'red' : 'emerald'}
                    fill
                    action={refreshButton}
                >
                    {staleReferences.length === 0 ? (
                        <EmptyState
                            icon={CheckCircle2}
                            title="No spec cites a file the graph has never seen"
                            hint="Every source path mentioned in a spec resolves to a real file in the dependency graph."
                        />
                    ) : (
                        <>
                            <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">
                                These specs cite files the graph has never seen — renamed or deleted without the spec being
                                updated. The spec is now describing a codebase that does not exist.
                            </p>
                            <div className="space-y-1.5 max-h-[480px] overflow-y-auto custom-scrollbar pr-1">
                                {staleReferences.map((entry, i) => (
                                    <div key={`${entry.spec}-${entry.reference}-${i}`} className="rounded-lg border border-red-500/10 bg-red-500/[0.04] px-3 py-2">
                                        <div className="flex items-center gap-2 mb-1">
                                            <AlertTriangle size={11} className="shrink-0 text-red-400" />
                                            <span className="font-mono text-[11px] text-slate-300 truncate">{entry.reference}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 pl-[19px] text-[10px] text-slate-600">
                                            cited in
                                            <span className="font-mono text-slate-400 truncate">{entry.spec}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </Panel>

                <Panel
                    title={`Undocumented Modules (${undocumentedCount})`}
                    icon={FileQuestion}
                    color={undocumentedCount > 0 ? 'indigo' : 'emerald'}
                    fill
                    action={
                        <div className="flex items-center gap-1.5">
                            <Label>Min dependents</Label>
                            <select
                                value={minDependents}
                                onChange={e => setMinDependents(Number(e.target.value))}
                                className="rounded-lg bg-black/40 border border-white/10 px-2 py-1 text-[10px] font-mono text-slate-300 focus:outline-none focus:border-indigo-500/50"
                            >
                                {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </div>
                    }
                >
                    {undocumented.length === 0 ? (
                        <EmptyState
                            icon={CheckCircle2}
                            title="Every load-bearing module is described by a spec"
                            hint={`No file with ${minDependents} or more dependents is missing from the specs.`}
                        />
                    ) : (
                        <>
                            <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">
                                Architecturally load-bearing files with no recorded intent. Click any one to see its structure
                                and semantic neighbours in Compose before writing the spec.
                            </p>
                            <div className="space-y-1 max-h-[480px] overflow-y-auto custom-scrollbar pr-1">
                                {undocumented.map((entry, i) => (
                                    <FileChip
                                        key={`${entry.file}-${i}`}
                                        file={entry.file}
                                        color="indigo"
                                        onOpen={onOpenFile}
                                        trailing={`${entry.dependents} dependent${entry.dependents === 1 ? '' : 's'}`}
                                    />
                                ))}
                            </div>
                            {undocumentedCount > undocumented.length && (
                                <p className="mt-2 text-[10px] text-slate-600 italic px-1">
                                    Showing the {undocumented.length} most-depended-on of {undocumentedCount}.
                                </p>
                            )}
                        </>
                    )}
                </Panel>
            </div>

            <Explainer title="How drift is derived" icon={Info}>
                <p><b className="text-slate-400">From the prose, not a DSL.</b> OpenSpec specs are written for people, so drift is read from the file paths the prose actually cites — no separate machine-readable architecture file to keep in sync.</p>
                <p><b className="text-slate-400">A name counts as a citation.</b> A spec that mentions <span className="font-mono text-slate-400">SpecDrift.js</span> without its directory still resolves, so renaming a directory is not reported as drift.</p>
                <p><b className="text-slate-400">Drift is an insight, never a blocker.</b> When either side is missing this tab says which one, rather than failing.</p>
            </Explainer>
        </div>
    );
}
