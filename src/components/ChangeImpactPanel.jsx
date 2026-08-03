/**
 * ChangeImpactPanel — what carrying out a proposed change would actually disturb.
 *
 * The board says what a change intends. This resolves every source file the
 * change's spec deltas cite against Graphify and reports the blast radius, test
 * coverage and risk of each — so a proposal that reads as a one-line tweak but
 * lands on an untested hub says so before anyone starts on it.
 *
 * This is OpenSpec's output feeding Graphify: the deltas supply the file list, the
 * graph supplies the consequences. Files the graph has never seen are reported as
 * stale, which is the Drift finding scoped to a single change.
 */

import React, { useState, useEffect } from 'react';
import {
    Network, AlertTriangle, CheckCircle2, ShieldAlert, FileWarning, Info, GitBranch,
} from 'lucide-react';
import { api } from '../api/api';
import {
    Panel, StatTile, FileChip, EmptyState, Centered, Spinner, Label, Explainer,
} from './StardustKit';

const RISK_COLORS = { high: 'red', moderate: 'amber', low: 'emerald' };
// Written out rather than interpolated — Tailwind only generates classes it can
// find as literal text in the source.
const RISK_TEXT = { high: 'text-red-400', moderate: 'text-amber-400', low: 'text-emerald-400' };

export default function ChangeImpactPanel({ changeName, projectRoot, onOpenFile }) {
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!changeName) {
            setReport(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        api.stardustChangeImpact(changeName, projectRoot)
            .then(data => { if (!cancelled) setReport(data); })
            .catch(err => { if (!cancelled) { setError(err.message); setReport(null); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [changeName, projectRoot]);

    if (loading) {
        return <Panel title="Change Impact" icon={Network} color="cyan"><Centered className="min-h-[120px]"><Spinner /></Centered></Panel>;
    }

    if (error) {
        return (
            <Panel title="Change Impact" icon={Network} color="cyan">
                <p className="text-[11px] text-red-400">{error}</p>
            </Panel>
        );
    }

    if (!report) return null;

    if (!report.available) {
        return (
            <Panel title="Change Impact" icon={Network} color="cyan">
                <EmptyState
                    compact
                    icon={GitBranch}
                    title={report.reason}
                    hint="With a graph built, every file this change's deltas cite is resolved to its dependents, blast radius and test coverage — so the cost of the change is visible from the board."
                />
            </Panel>
        );
    }

    const { files, totals, citedCount, deltaCount } = report;

    if (citedCount === 0) {
        return (
            <Panel title="Change Impact" icon={Network} color="cyan">
                <EmptyState
                    compact
                    icon={Info}
                    title="These deltas cite no source files"
                    hint={`${deltaCount} requirement${deltaCount === 1 ? '' : 's'} were read. Citing the files a requirement governs is what lets the graph report its blast radius here.`}
                />
            </Panel>
        );
    }

    const worst = totals.highestRisk || 'low';

    return (
        <Panel
            title={`Change Impact — ${citedCount} cited file${citedCount === 1 ? '' : 's'}`}
            icon={Network}
            color="cyan"
            action={<Label color={RISK_TEXT[worst] || 'text-slate-500'}>{worst} risk</Label>}
        >
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 mb-4">
                <StatTile label="Blast radius" value={totals.blastRadius} hint="files reached" color={totals.blastRadius >= 10 ? 'red' : 'cyan'} icon={Network} />
                <StatTile label="Untested" value={totals.untested} hint="of cited files" color={totals.untested === 0 ? 'emerald' : 'red'} icon={totals.untested === 0 ? CheckCircle2 : AlertTriangle} />
                <StatTile label="Stale citations" value={totals.stale} hint="not in graph" color={totals.stale === 0 ? 'emerald' : 'red'} icon={FileWarning} />
                <StatTile label="Highest risk" value={worst} color={RISK_COLORS[worst] || 'slate'} icon={ShieldAlert} />
            </div>

            <div className="space-y-1.5 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                {files.map((entry, i) => (
                    <div
                        key={`${entry.reference}-${i}`}
                        className={`rounded-lg border px-3 py-2 ${
                            entry.stale ? 'border-red-500/10 bg-red-500/[0.04]' : 'border-white/5 bg-black/25'
                        }`}
                    >
                        <div className="flex items-center gap-2">
                            {entry.stale
                                ? <FileWarning size={11} className="shrink-0 text-red-400" />
                                : <GitBranch size={11} className="shrink-0 text-cyan-400" />}
                            <span className="font-mono text-[11px] text-slate-300 truncate" title={entry.reference}>
                                {entry.file || entry.reference}
                            </span>
                            {entry.stale ? (
                                <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-widest text-red-400">
                                    not in graph
                                </span>
                            ) : (
                                <div className="ml-auto shrink-0 flex items-center gap-2 text-[10px]">
                                    <span className="text-slate-500">{entry.dependents} dep</span>
                                    <span className="text-slate-600">·</span>
                                    <span className={entry.blastRadius >= 5 ? 'text-amber-400' : 'text-slate-500'}>
                                        {entry.blastRadius} reached
                                    </span>
                                    <span className="text-slate-600">·</span>
                                    <span className={entry.coveredByTests ? 'text-emerald-400' : 'text-red-400'}>
                                        {entry.coveredByTests ? `${entry.testCount} test${entry.testCount === 1 ? '' : 's'}` : 'untested'}
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="mt-1 pl-[19px] text-[10px] text-slate-600 truncate" title={entry.requirements.join(' · ')}>
                            {entry.stale
                                ? `cited by "${entry.requirements[0]}" — renamed or deleted without the spec being updated`
                                : `governed by ${entry.requirements.length} requirement${entry.requirements.length === 1 ? '' : 's'}: ${entry.requirements.join(' · ')}`}
                        </div>

                        {entry.file && onOpenFile && (
                            <div className="mt-1">
                                <FileChip file={entry.file} color={entry.stale ? 'red' : 'cyan'} onOpen={onOpenFile} trailing="compose" />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <Explainer title="Where these numbers come from" icon={Info}>
                <p><b className="text-slate-400">The deltas supply the file list.</b> Every source path the change's requirements cite is extracted from the prose — the same reading the Drift tab uses.</p>
                <p><b className="text-slate-400">The graph supplies the consequences.</b> Blast radius is two hops of reverse dependencies; risk combines that reach with whether any test covers the file.</p>
            </Explainer>
        </Panel>
    );
}
