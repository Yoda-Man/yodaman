/**
 * Stardust — the cross-tool dashboard over Context Expert, Graphify and OpenSpec.
 *
 * All three tools are mandatory, so this is where they are connected rather than
 * each stopping at its own tab. Two mechanisms do that work:
 *
 *   PipelineStrip — the three layers plus their combined drift verdict, on every
 *                   tab, each segment linking to the tab that consumes it.
 *   focusFile     — one file handed between tabs. Anything that surfaces a file
 *                   (drift findings, search hits, a change's cited files) hands it
 *                   to Compose, which shows all three tools' view of it at once.
 *
 * Tabs: Board | Drift | Compose | Trust | Trace | Diagnostics | Commands
 * Every tab fills the full width — the panels own their own responsive grids.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Zap, Activity, CheckCircle2, XCircle, Play, FileCheck, Archive,
    FolderOpen, Terminal, Download, RefreshCw, Loader2, GitCompare,
    LayoutGrid, Link2, Shield, Search, Trash2, BarChart3,
} from 'lucide-react';
import { api } from '../api/api';
import { useStardustLive } from '../hooks/useStardustLive';
import { useStardustPipeline } from '../hooks/useStardustPipeline';
import ChangeCard from './ChangeCard';
import SpecDiff from './SpecDiff';
import SpecDriftPanel from './SpecDriftPanel';
import ComposePanel from './ComposePanel';
import TrustDashboard from './TrustDashboard';
import SearchTrace from './SearchTrace';
import ImpactAnalysisTab from './ImpactAnalysisTab';
import ChangeImpactPanel from './ChangeImpactPanel';
import PipelineStrip from './PipelineStrip';
import { ActivityDrawer, ActivityRail } from './ActivityFeed';
import { Panel, StatTile, EmptyState, Label, GhostButton } from './StardustKit';

// ── Console helpers ──

const LINE_COLORS = {
    success: 'text-emerald-400', error: 'text-red-400', warning: 'text-amber-400',
    info: 'text-cyan-300', default: 'text-slate-300',
};

function classifyLine(line) {
    const lower = line.toLowerCase();
    if (/error|fail|fatal|exception/i.test(lower)) return 'error';
    if (/warn|warning/i.test(lower)) return 'warning';
    if (/success|pass|ok|applied|archived|created/i.test(lower)) return 'success';
    if (/info|note|tip|hint/i.test(lower)) return 'info';
    return 'default';
}

function ConsoleLine({ text, type }) {
    return (
        <div className={`font-mono text-xs leading-5 ${LINE_COLORS[type] || LINE_COLORS.default} whitespace-pre-wrap break-all`}>
            {text}
        </div>
    );
}

function DiagRow({ label, ok, okText, failText }) {
    return (
        <div className="rounded-xl bg-black/25 border border-white/5 px-4 py-3 flex items-center justify-between gap-3">
            <Label>{label}</Label>
            <div className="flex items-center gap-1.5 shrink-0">
                {ok === undefined || ok === null ? (
                    <><Loader2 size={13} className="animate-spin text-slate-500" /><span className="text-[11px] text-slate-500">Checking…</span></>
                ) : ok ? (
                    <><CheckCircle2 size={13} className="text-emerald-400" /><span className="text-[11px] font-mono text-emerald-400">{okText}</span></>
                ) : (
                    <><XCircle size={13} className="text-red-400" /><span className="text-[11px] text-red-400">{failText}</span></>
                )}
            </div>
        </div>
    );
}

function ActionButton({ icon: Icon, label, color, loading, disabled, onClick }) {
    const colorMap = {
        indigo: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300 hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:text-white',
        cyan: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-500/20 hover:text-white',
        emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:border-emerald-400/50 hover:bg-emerald-500/20 hover:text-white',
        amber: 'border-amber-500/20 bg-amber-500/10 text-amber-300 hover:border-amber-400/50 hover:bg-amber-500/20 hover:text-white',
    };
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed ${colorMap[color] || colorMap.indigo}`}
        >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
            {label}
        </button>
    );
}

// ── Main ──

const TABS = [
    { id: 'board', icon: LayoutGrid, label: 'Board' },
    { id: 'drift', icon: GitCompare, label: 'Drift' },
    { id: 'compose', icon: Link2, label: 'Compose' },
    { id: 'trust', icon: Shield, label: 'Trust' },
    { id: 'trace', icon: Search, label: 'Trace' },
    { id: 'diagnostics', icon: Activity, label: 'Diagnostics' },
    { id: 'commands', icon: Terminal, label: 'Commands' },
    { id: 'impact', icon: BarChart3, label: 'Impact' },
];

export default function Stardust({ selectedProject }) {
    const [tab, setTab] = useState('board');

    const effectiveCwd = selectedProject?.path || '';
    const { snapshot, activity, connected } = useStardustLive(effectiveCwd);
    const { pipeline, loading: pipelineLoading, refresh: refreshPipeline } = useStardustPipeline(effectiveCwd);

    // The file currently being handed between tabs. `nonce` forces Compose to
    // re-run when the same file is opened twice — otherwise clicking the same
    // finding again after switching tabs would do nothing.
    const [focus, setFocus] = useState({ file: null, nonce: 0 });

    const [selectedChange, setSelectedChange] = useState(null);

    // Diagnostics state
    const [diagnostics, setDiagnostics] = useState(null);
    const [diagLoading, setDiagLoading] = useState(false);
    const [diagError, setDiagError] = useState(null);

    // Command state
    const [changeId, setChangeId] = useState('');
    const [running, setRunning] = useState(false);
    const [currentAction, setCurrentAction] = useState(null);

    // Console
    const [consoleLines, setConsoleLines] = useState([]);
    const consoleEndRef = useRef(null);

    const appendConsole = useCallback((text, type) => {
        const lines = String(text).split('\n').filter(l => l.trim());
        setConsoleLines(prev => [...prev, ...lines.map(l => ({ text: l, type: type || classifyLine(l), ts: Date.now() }))]);
    }, []);

    useEffect(() => { consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [consoleLines]);

    /** Hand a file to Compose — the handoff every tab uses. */
    const openFile = useCallback((file) => {
        if (!file) return;
        setFocus(prev => ({ file, nonce: prev.nonce + 1 }));
        setTab('compose');
    }, []);

    const clearFocus = useCallback(() => setFocus({ file: null, nonce: 0 }), []);

    // A different workspace has nothing to do with the previous one's selection.
    useEffect(() => {
        setFocus({ file: null, nonce: 0 });
        setSelectedChange(null);
    }, [effectiveCwd]);

    // ── Diagnostics ──

    const runDiagnostics = useCallback(async () => {
        setDiagLoading(true);
        setDiagError(null);
        try {
            setDiagnostics(await api.stardustDiagnose(effectiveCwd));
        } catch (err) {
            setDiagError(err.message);
        } finally {
            setDiagLoading(false);
        }
    }, [effectiveCwd]);

    useEffect(() => { if (effectiveCwd) runDiagnostics(); }, [effectiveCwd, runDiagnostics]);

    // ── Command runner ──

    const runAction = async (action, extra = {}) => {
        setRunning(true);
        setCurrentAction(action);
        appendConsole(`\n── ${action.toUpperCase()} ──`, 'info');
        try {
            const target = extra.changeId || changeId || undefined;
            const result = await api.stardustRun({ action, changeId: target, projectRoot: effectiveCwd || undefined, ...extra });
            if (result.stdout) appendConsole(result.stdout, 'default');
            if (result.stderr) appendConsole(result.stderr, 'warning');
            appendConsole(result.success ? `✓ ${action} completed` : `✗ ${action} failed`, result.success ? 'success' : 'error');

            // Record the verdict against the change so its card stops saying "unknown".
            if (action === 'validate' && target) {
                try { await api.stardustSetValidation(target, result.success ? 'ok' : 'error'); } catch (_) { /* card keeps its prior state */ }
            }
            // Validating or archiving changes what the other tabs are reading.
            if (action === 'validate' || action === 'archive') refreshPipeline();
            return result;
        } catch (err) {
            appendConsole(`✗ ${action} error: ${err.message}`, 'error');
            return { success: false, error: err.message };
        } finally {
            setRunning(false);
            setCurrentAction(null);
        }
    };

    const handleInstall = async () => {
        setRunning(true);
        setCurrentAction('install');
        appendConsole('\n── INSTALL ──', 'info');
        try {
            const result = await api.stardustRun({ action: 'install' });
            if (result.stdout) appendConsole(result.stdout, 'default');
            appendConsole(result.success ? '✓ Installation complete' : '✗ Installation failed', result.success ? 'success' : 'error');
            if (result.success) { runDiagnostics(); refreshPipeline(); }
        } catch (err) {
            appendConsole(`✗ Install error: ${err.message}`, 'error');
        } finally {
            setRunning(false);
            setCurrentAction(null);
        }
    };

    const handleInit = async () => {
        setRunning(true);
        setCurrentAction('init');
        appendConsole('\n── INIT ──', 'info');
        try {
            const result = await api.stardustRun({ action: 'init', projectRoot: effectiveCwd, tools: 'all' });
            if (result.stdout) appendConsole(result.stdout, 'default');
            if (result.success) {
                appendConsole('✓ Project initialized', 'success');
                runDiagnostics();
                refreshPipeline();
            } else {
                appendConsole('✗ Initialization failed', 'error');
            }
        } catch (err) {
            appendConsole(`✗ Init error: ${err.message}`, 'error');
        } finally {
            setRunning(false);
            setCurrentAction(null);
        }
    };

    // ── Empty state ──

    if (!selectedProject) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-[#020617] text-slate-300 selection:bg-indigo-500/30 px-8">
                <div className="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-6">
                    <Zap size={36} className="text-amber-400/60" />
                </div>
                <h1 className="text-2xl font-black tracking-tight text-white mb-2">⚡ Project Stardust</h1>
                <p className="text-sm text-slate-500 max-w-md text-center leading-relaxed">The blueprints for your codebase.</p>
                <div className="mt-8 rounded-2xl border border-amber-500/10 bg-amber-500/[0.03] px-6 py-5 max-w-md text-center">
                    <FolderOpen size={28} className="text-amber-400/40 mx-auto mb-3" />
                    <p className="text-sm text-slate-400 font-medium mb-1">No active workspace selected</p>
                    <p className="text-xs text-slate-600 leading-relaxed">
                        Select a project from the sidebar to see its changes, drift and cross-tool views.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-[#020617] text-slate-300 selection:bg-indigo-500/30">
            {/* Header */}
            <header className="shrink-0 px-6 pt-5 pb-3 border-b border-white/5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-xl bg-amber-500/10 border border-amber-500/20">
                            <Zap size={18} className="text-amber-400" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-xl font-black tracking-tight text-white">⚡ Project Stardust</h1>
                            <p className="text-[10px] text-slate-500 mt-0.5 truncate" title={effectiveCwd}>{effectiveCwd}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        <span
                            className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}
                            title={connected ? 'Live — watching openspec/' : 'Disconnected'}
                        />
                        <ActivityDrawer activity={activity} />
                    </div>
                </div>

                {/* Tabs */}
                <nav className="flex items-center gap-1 flex-wrap">
                    {TABS.map(t => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setTab(t.id)}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                                tab === t.id
                                    ? 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
                                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'
                            }`}
                        >
                            <t.icon size={12} />
                            {t.label}
                        </button>
                    ))}
                </nav>

                {/* The three tools as a pipeline — visible on every tab */}
                <PipelineStrip
                    pipeline={pipeline}
                    loading={pipelineLoading}
                    onRefresh={refreshPipeline}
                    activeTab={tab}
                    onNavigate={setTab}
                    focusFile={focus.file}
                    onClearFocus={clearFocus}
                />
            </header>

            {/* Content — full width; each tab owns its own grid */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-4">
                {tab === 'board' && (
                    <BoardTab
                        snapshot={snapshot}
                        activity={activity}
                        connected={connected}
                        projectRoot={effectiveCwd}
                        selectedChange={selectedChange}
                        onSelectChange={setSelectedChange}
                        onOpenFile={openFile}
                        running={running}
                        currentAction={currentAction}
                        onValidate={name => { setChangeId(name); runAction('validate', { changeId: name }); }}
                        onArchive={name => { setChangeId(name); runAction('archive', { changeId: name }); }}
                    />
                )}

                {tab === 'drift' && (
                    <SpecDriftPanel
                        projectRoot={effectiveCwd}
                        drift={pipeline.drift}
                        loading={pipelineLoading}
                        onRefresh={refreshPipeline}
                        onOpenFile={openFile}
                    />
                )}

                {tab === 'compose' && (
                    <ComposePanel
                        projectRoot={effectiveCwd}
                        // Remount on each handoff so the same file opened twice still composes.
                        key={`compose-${focus.nonce}`}
                        focusFile={focus.file || ''}
                        onOpenFile={openFile}
                    />
                )}

                {tab === 'trust' && (
                    <TrustDashboard
                        pipeline={pipeline}
                        loading={pipelineLoading}
                        onRefresh={refreshPipeline}
                        onNavigate={setTab}
                    />
                )}

                {tab === 'trace' && (
                    <SearchTrace
                        projectRoot={effectiveCwd}
                        focusFile={focus.file}
                        onOpenFile={openFile}
                    />
                )}

                {tab === 'diagnostics' && (
                    <DiagnosticsTab
                        diagnostics={diagnostics}
                        diagError={diagError}
                        diagLoading={diagLoading}
                        onRun={runDiagnostics}
                        onInstall={handleInstall}
                        onInit={handleInit}
                        running={running}
                        currentAction={currentAction}
                        pipeline={pipeline}
                    />
                )}

                {tab === 'commands' && (
                    <CommandsTab
                        changeId={changeId}
                        setChangeId={setChangeId}
                        changes={snapshot.changes}
                        running={running}
                        currentAction={currentAction}
                        runAction={runAction}
                        consoleLines={consoleLines}
                        consoleEndRef={consoleEndRef}
                        onClearConsole={() => setConsoleLines([])}
                    />
                )}

                {tab === 'impact' && (
                    <ImpactAnalysisTab projectRoot={effectiveCwd} />
                )}
            </div>
        </div>
    );
}

// ── Board ──

/**
 * Three columns on a wide screen: the change list, the selected change's deltas
 * and graph impact, and the live activity feed. The middle column is where
 * OpenSpec's deltas and Graphify's blast radius sit together.
 */
function BoardTab({
    snapshot, activity, connected, projectRoot, selectedChange, onSelectChange,
    onOpenFile, running, currentAction, onValidate, onArchive,
}) {
    const changes = snapshot.changes;

    // A change that disappeared from the snapshot (archived, renamed) must not
    // leave a stale diff on screen.
    const selected = selectedChange && changes.some(c => c.name === selectedChange.name)
        ? changes.find(c => c.name === selectedChange.name)
        : null;

    useEffect(() => {
        if (selectedChange && !selected) onSelectChange(null);
    }, [selectedChange, selected, onSelectChange]);

    const totalTasks = changes.reduce((sum, c) => sum + c.taskTotal, 0);
    const doneTasks = changes.reduce((sum, c) => sum + c.taskCompleted, 0);
    const validated = changes.filter(c => c.validation === 'ok').length;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-4 gap-3">
                <StatTile label="Changes" value={changes.length} hint="in flight" color="amber" icon={LayoutGrid} />
                <StatTile label="Tasks done" value={`${doneTasks}/${totalTasks}`} hint={totalTasks > 0 ? `${Math.round((doneTasks / totalTasks) * 100)}%` : 'none yet'} color="emerald" icon={CheckCircle2} />
                <StatTile label="Validated" value={validated} hint={`of ${changes.length}`} color={validated === changes.length && changes.length > 0 ? 'emerald' : 'slate'} icon={FileCheck} />
                <StatTile
                    label="Graph"
                    value={snapshot.graphStatus === 'current' ? 'Current' : snapshot.graphStatus === 'stale' ? 'Stale' : 'None'}
                    hint="structure for impact"
                    color={snapshot.graphStatus === 'current' ? 'emerald' : snapshot.graphStatus === 'stale' ? 'amber' : 'red'}
                    icon={GitCompare}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 2xl:grid-cols-4 gap-4 items-start">
                {/* Change list */}
                <div className="lg:col-span-1 space-y-2.5">
                    <div className="flex items-center justify-between px-1">
                        <Label>{changes.length} Change{changes.length !== 1 ? 's' : ''}</Label>
                        {!snapshot.ready && <Label color="text-amber-400">openspec/ not found</Label>}
                    </div>
                    {changes.length === 0 ? (
                        <Panel>
                            <EmptyState
                                compact
                                icon={FolderOpen}
                                title={snapshot.ready ? 'No OpenSpec changes yet' : 'OpenSpec is not initialized here'}
                                hint={snapshot.ready
                                    ? 'A change is a directory under openspec/changes/ holding a proposal, tasks and spec deltas.'
                                    : 'Use the Diagnostics tab to initialize OpenSpec for this workspace.'}
                            />
                        </Panel>
                    ) : (
                        changes.map(c => (
                            <ChangeCard key={c.name} change={c} selected={selected?.name === c.name} onClick={onSelectChange} />
                        ))
                    )}
                </div>

                {/* Selected change: deltas + graph impact */}
                <div className="lg:col-span-2 space-y-4">
                    {selected ? (
                        <>
                            <Panel
                                title={selected.name}
                                icon={FileCheck}
                                color="amber"
                                action={
                                    <>
                                        <ActionButton icon={FileCheck} label="Validate" color="cyan" loading={running && currentAction === 'validate'} disabled={running} onClick={() => onValidate(selected.name)} />
                                        <ActionButton icon={Archive} label="Archive" color="amber" loading={running && currentAction === 'archive'} disabled={running} onClick={() => onArchive(selected.name)} />
                                    </>
                                }
                            >
                                <p className="text-[10px] text-slate-500 mb-4">
                                    {selected.status} · {selected.taskCompleted}/{selected.taskTotal} tasks · validation {selected.validation}
                                </p>
                                <SpecDiff changeName={selected.name} projectRoot={projectRoot} />
                            </Panel>

                            {/* OpenSpec's deltas measured against Graphify's structure */}
                            <ChangeImpactPanel changeName={selected.name} projectRoot={projectRoot} onOpenFile={onOpenFile} />
                        </>
                    ) : (
                        <Panel title="Spec Deltas" icon={GitCompare} color="amber">
                            <EmptyState
                                icon={GitCompare}
                                title="Select a change to review"
                                hint="Each change shows its spec deltas beside the published spec, plus the blast radius of every file its requirements cite — so you can see what the change intends and what it would disturb in one place."
                            />
                        </Panel>
                    )}
                </div>

                {/* Live feed — the dashboard's own column on wide screens */}
                <div className="lg:col-span-3 2xl:col-span-1 h-[420px] 2xl:h-[640px]">
                    <ActivityRail activity={activity} connected={connected} />
                </div>
            </div>
        </div>
    );
}

// ── Diagnostics ──

function DiagnosticsTab({ diagnostics, diagError, diagLoading, onRun, onInstall, onInit, running, currentAction, pipeline }) {
    const readiness = [
        ['OpenSpec CLI installed', diagnostics?.installed],
        ['Workspace initialized', diagnostics?.projectRootFound],
        ['Knowledge graph built', pipeline.layers.graph.state === 'ready' || pipeline.layers.graph.state === 'stale'],
        ['Specs written', pipeline.drift?.available === true],
        ['Ready to validate & archive', Boolean(diagnostics?.installed && diagnostics?.projectRootFound)],
    ];

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <DiagRow label="Installation" ok={diagnostics?.installed} okText="Installed" failText="Missing" />
                <DiagRow label="Version" ok={!!diagnostics?.version} okText={diagnostics?.version || '—'} failText="Unknown" />
                <DiagRow label="openspec/config.yaml" ok={diagnostics?.projectRootFound} okText="Found" failText="Not found" />
            </div>

            {diagError && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2.5 text-xs text-red-400">{diagError}</div>
            )}
            {diagnostics?.errors?.map((e, i) => (
                <div key={i} className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2.5 text-xs text-red-400">{e}</div>
            ))}

            <div className="flex flex-wrap items-center gap-2">
                <ActionButton icon={RefreshCw} label="Run Diagnostics" color="indigo" loading={diagLoading} disabled={diagLoading} onClick={onRun} />
                {diagnostics && !diagnostics.installed && (
                    <ActionButton icon={Download} label="Install Now" color="amber" loading={running && currentAction === 'install'} disabled={running} onClick={onInstall} />
                )}
                {diagnostics?.installed && !diagnostics?.projectRootFound && (
                    <ActionButton icon={Play} label="Initialize Project" color="emerald" loading={running && currentAction === 'init'} disabled={running} onClick={onInit} />
                )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                <Panel title="Workflow Readiness" icon={Activity} color="indigo" fill>
                    <div className="space-y-2.5">
                        {readiness.map(([label, ready]) => (
                            <div key={label} className="flex items-center gap-3 text-[11px]">
                                <span className="w-44 shrink-0 text-slate-400">{label}</span>
                                <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-500 ${ready ? 'bg-emerald-400' : 'bg-slate-700'}`}
                                        style={{ width: ready ? '100%' : '12%' }}
                                    />
                                </div>
                                <span className={`w-8 shrink-0 text-right ${ready ? 'text-emerald-300' : 'text-slate-600'}`}>
                                    {ready ? 'Yes' : 'No'}
                                </span>
                            </div>
                        ))}
                    </div>
                </Panel>

                <Panel title="Tool Detail" icon={Shield} color="indigo" fill>
                    <div className="space-y-2.5">
                        {[
                            ['Context Expert', pipeline.layers.ctx],
                            ['Graphify', pipeline.layers.graph],
                            ['OpenSpec', pipeline.layers.spec],
                        ].map(([name, layer]) => (
                            <div key={name} className="rounded-xl border border-white/5 bg-black/25 px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                    <Label color="text-slate-300">{name}</Label>
                                    <span className="text-[10px] font-mono text-slate-500">{layer.state}</span>
                                    {layer.version && <span className="ml-auto text-[9px] font-mono text-slate-600">v{layer.version}</span>}
                                </div>
                                <p className="mt-1 text-[10px] text-slate-500 leading-relaxed">{layer.detail}</p>
                            </div>
                        ))}
                    </div>
                </Panel>
            </div>
        </div>
    );
}

// ── Commands ──

function CommandsTab({
    changeId, setChangeId, changes, running, currentAction, runAction,
    consoleLines, consoleEndRef, onClearConsole,
}) {
    return (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,26rem)_1fr] gap-4 items-start">
            {/* Controls */}
            <div className="space-y-4">
                <Panel title="Target" icon={FileCheck} color="cyan">
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Change / spec name</Label>
                            <input
                                type="text"
                                value={changeId}
                                onChange={e => setChangeId(e.target.value)}
                                placeholder="e.g. add-auth-middleware"
                                className="w-full rounded-xl bg-black/35 border border-white/10 px-4 py-2 text-xs font-mono text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                            />
                        </div>

                        {/* Picking from the live board beats retyping a directory name. */}
                        {changes.length > 0 && (
                            <div className="space-y-1.5">
                                <Label>Or pick from the board</Label>
                                <div className="flex flex-wrap gap-1.5">
                                    {changes.map(c => (
                                        <button
                                            key={c.name}
                                            type="button"
                                            onClick={() => setChangeId(c.name)}
                                            className={`rounded-lg border px-2.5 py-1 font-mono text-[10px] transition-colors ${
                                                changeId === c.name
                                                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                                                    : 'border-white/5 text-slate-500 hover:text-slate-300 hover:border-white/10'
                                            }`}
                                        >
                                            {c.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </Panel>

                <Panel title="Actions" icon={Terminal} color="indigo">
                    <div className="flex flex-wrap items-center gap-2">
                        <ActionButton icon={FileCheck} label="Validate" color="cyan" loading={running && currentAction === 'validate'} disabled={running || !changeId} onClick={() => runAction('validate')} />
                        <ActionButton icon={Archive} label="Archive" color="amber" loading={running && currentAction === 'archive'} disabled={running || !changeId} onClick={() => runAction('archive')} />
                        <ActionButton icon={Play} label="Propose" color="emerald" loading={running && currentAction === 'propose'} disabled={running || !changeId} onClick={() => runAction('propose')} />
                        <ActionButton icon={RefreshCw} label="List Changes" color="indigo" loading={running && currentAction === 'list'} disabled={running} onClick={() => runAction('list')} />
                        <ActionButton icon={FileCheck} label="List Specs" color="emerald" loading={running && currentAction === 'list'} disabled={running} onClick={() => runAction('list', { specs: true })} />
                    </div>
                    <p className="mt-3 text-[10px] text-slate-600 leading-relaxed">
                        Validate records its verdict against the change, so the board's health icon reflects the last real run
                        rather than staying unknown.
                    </p>
                </Panel>
            </div>

            {/* Console — fills the rest of the width and most of the height */}
            <Panel
                title="Console"
                icon={Terminal}
                color="emerald"
                action={consoleLines.length > 0 && (
                    <GhostButton icon={Trash2} label="Clear" color="slate" onClick={onClearConsole} />
                )}
                padded={false}
            >
                <div className="rounded-b-2xl bg-black/50 p-4 h-[calc(100vh-24rem)] min-h-[320px] overflow-y-auto custom-scrollbar">
                    {consoleLines.length === 0 ? (
                        <div className="text-xs text-slate-600 italic">Run a command to see its output here…</div>
                    ) : (
                        consoleLines.map((line, i) => <ConsoleLine key={`${line.ts}-${i}`} text={line.text} type={line.type} />)
                    )}
                    <div ref={consoleEndRef} />
                </div>
            </Panel>
        </div>
    );
}
