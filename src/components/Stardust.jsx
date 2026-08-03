/**
 * Stardust — OpenSpec dashboard with real-time change board, spec diff,
 * activity feed, architecture drift detection, and CLI commands.
 *
 * Tabs: Board (cards + diff) | Drift | Diagnostics | Commands
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Zap, Activity, CheckCircle2, XCircle, Play, FileCheck, Archive,
    FolderOpen, Terminal, Download, RefreshCw, ChevronDown, ChevronRight,
    Loader2, Clipboard, BarChart3, LayoutGrid, GitCompare, Wrench,
    AlertTriangle,
} from 'lucide-react';
import { api } from '../api/api';
import { useStardustLive } from '../hooks/useStardustLive';
import ChangeCard from './ChangeCard';
import SpecDiff from './SpecDiff';
import SpecDriftPanel from './SpecDriftPanel';
import { ActivityDrawer } from './ActivityFeed';

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
    return <div className={`font-mono text-xs leading-5 ${LINE_COLORS[type] || LINE_COLORS.default} whitespace-pre-wrap break-all`}>{text}</div>;
}

function CollapsibleSection({ title, icon: Icon, defaultOpen = true, children, rightContent }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-2">
                    <Icon size={16} className="text-indigo-400" />
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-300">{title}</span>
                </div>
                <div className="flex items-center gap-3">
                    {rightContent}
                    {open ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                </div>
            </button>
            {open && <div className="px-5 pb-4">{children}</div>}
        </div>
    );
}

function DiagRow({ label, ok, okText, failText }) {
    return (
        <div className="rounded-xl bg-black/25 border border-white/5 px-4 py-3 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
            <div className="flex items-center gap-1.5">
                {ok === undefined || ok === null ? (
                    <><Loader2 size={13} className="animate-spin text-slate-500" /><span className="text-[11px] text-slate-500">Checking...</span></>
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
        <button onClick={onClick} disabled={disabled}
            className={`inline-flex items-center gap-1.5 rounded-xl border font-bold uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-xs ${colorMap[color] || colorMap.indigo}`}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
            {label}
        </button>
    );
}

// ── Main ──

export default function Stardust({ selectedProject }) {
    // Tabs
    const [tab, setTab] = useState('board'); // board | drift | diagnostics | commands

    // Live data
    const effectiveCwd = selectedProject?.path || '';
    const { snapshot, activity, connected } = useStardustLive(effectiveCwd);

    // Selected change for diff panel
    const [selectedChange, setSelectedChange] = useState(null);

    // Diagnostics state
    const [diagnostics, setDiagnostics] = useState(null);
    const [diagLoading, setDiagLoading] = useState(false);
    const [diagError, setDiagError] = useState(null);

    // Command state
    const [changeId, setChangeId] = useState('');
    const [running, setRunning] = useState(false);
    const [currentAction, setCurrentAction] = useState(null);
    const [actionRuns, setActionRuns] = useState([]);

    // Console
    const [consoleLines, setConsoleLines] = useState([]);
    const consoleEndRef = useRef(null);

    const appendConsole = useCallback((text, type) => {
        const lines = text.split('\n').filter(l => l.trim());
        setConsoleLines(prev => [...prev, ...lines.map(l => ({ text: l, type: type || classifyLine(l), ts: Date.now() }))]);
    }, []);

    useEffect(() => { consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [consoleLines]);

    // ── Diagnostics ──

    const runDiagnostics = async () => {
        setDiagLoading(true); setDiagError(null);
        try {
            const result = await api.stardustDiagnose(effectiveCwd);
            setDiagnostics(result);
        } catch (err) { setDiagError(err.message); }
        finally { setDiagLoading(false); }
    };

    useEffect(() => { if (effectiveCwd) runDiagnostics(); }, [effectiveCwd]);

    // ── Command runner ──

    const runAction = async (action, extra = {}) => {
        setRunning(true); setCurrentAction(action);
        appendConsole(`\n── ${action.toUpperCase()} ──`, 'info');
        try {
            const result = await api.stardustRun({ action, changeId: changeId || undefined, projectRoot: effectiveCwd || undefined, ...extra });
            if (result.stdout) appendConsole(result.stdout, 'default');
            if (result.stderr) appendConsole(result.stderr, 'warning');
            appendConsole(result.success ? `✓ ${action} completed` : `✗ ${action} failed`, result.success ? 'success' : 'error');
            setActionRuns(prev => [...prev.slice(-11), { action: extra.specs ? 'list specs' : action, success: result.success, at: Date.now() }]);
            // After validate, update validation status for the change card
            if (action === 'validate' && changeId) {
                try { await api.stardustSetValidation(changeId, result.success ? 'ok' : 'error'); } catch (_) {}
            }
            return result;
        } catch (err) { appendConsole(`✗ ${action} error: ${err.message}`, 'error'); return { success: false, error: err.message }; }
        finally { setRunning(false); setCurrentAction(null); }
    };

    const handleInstall = async () => {
        setRunning(true); setCurrentAction('install');
        appendConsole('\n── INSTALL ──', 'info');
        try {
            const result = await api.stardustRun({ action: 'install' });
            if (result.stdout) appendConsole(result.stdout, 'default');
            appendConsole(result.success ? '✓ Installation complete' : '✗ Installation failed', result.success ? 'success' : 'error');
        } catch (err) { appendConsole(`✗ Install error: ${err.message}`, 'error'); }
        finally { setRunning(false); setCurrentAction(null); }
    };

    const handleInit = async () => {
        setRunning(true); setCurrentAction('init');
        appendConsole('\n── INIT ──', 'info');
        try {
            const result = await api.stardustRun({ action: 'init', projectRoot: effectiveCwd, tools: 'all' });
            if (result.stdout) appendConsole(result.stdout, 'default');
            if (result.success) { appendConsole('✓ Project initialized', 'success'); runDiagnostics(); }
            else appendConsole('✗ Initialization failed', 'error');
        } catch (err) { appendConsole(`✗ Init error: ${err.message}`, 'error'); }
        finally { setRunning(false); setCurrentAction(null); }
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
                    <p className="text-xs text-slate-600 leading-relaxed">Select a project from the sidebar to start using OpenSpec through the Stardust workflow.</p>
                </div>
            </div>
        );
    }

    // ── Render ──

    const tabs = [
        { id: 'board', icon: LayoutGrid, label: 'Board' },
        { id: 'drift', icon: GitCompare, label: 'Drift' },
        { id: 'diagnostics', icon: Activity, label: 'Diagnostics' },
        { id: 'commands', icon: Terminal, label: 'Commands' },
    ];

    return (
        <div className="h-full flex flex-col bg-[#020617] text-slate-300 selection:bg-indigo-500/30">
            {/* Header */}
            <header className="shrink-0 px-6 pt-5 pb-3 border-b border-white/5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-amber-500/10 border border-amber-500/20">
                            <Zap size={18} className="text-amber-400" />
                        </div>
                        <div>
                            <h1 className="text-xl font-black tracking-tight text-white">⚡ Project Stardust</h1>
                            <p className="text-[10px] text-slate-500 mt-0.5">{effectiveCwd}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Connection indicator */}
                        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} title={connected ? 'Live' : 'Disconnected'} />
                        <ActivityDrawer activity={activity} />
                    </div>
                </div>

                {/* Tabs */}
                <nav className="flex items-center gap-1 mt-4">
                    {tabs.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                                tab === t.id
                                    ? 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
                                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'
                            }`}>
                            <t.icon size={12} />
                            {t.label}
                        </button>
                    ))}
                </nav>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-4">
                {/* ── BOARD TAB ── */}
                {tab === 'board' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* Left: Change cards */}
                        <div className="lg:col-span-1 space-y-3">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                    {snapshot.changes.length} Change{snapshot.changes.length !== 1 ? 's' : ''}
                                </span>
                                <span className="text-[10px] text-slate-600">
                                    {snapshot.graphStatus === 'current' ? '🟢 Graph current' : snapshot.graphStatus === 'stale' ? '🟡 Graph stale' : '⚪ No graph'}
                                </span>
                            </div>
                            {snapshot.changes.length === 0 ? (
                                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center">
                                    <FolderOpen size={24} className="text-slate-600 mx-auto mb-3" />
                                    <p className="text-xs text-slate-500 mb-1">No OpenSpec changes yet</p>
                                    <p className="text-[10px] text-slate-600">Run <code className="text-amber-400">openspec init .</code> or use the Diagnostics tab to get started.</p>
                                </div>
                            ) : (
                                snapshot.changes.map(c => (
                                    <ChangeCard key={c.name} change={c} selected={selectedChange?.name === c.name} onClick={setSelectedChange} />
                                ))
                            )}
                        </div>

                        {/* Right: Spec diff for selected change */}
                        <div className="lg:col-span-2">
                            {selectedChange ? (
                                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <div>
                                            <h2 className="text-sm font-bold text-white font-mono">{selectedChange.name}</h2>
                                            <p className="text-[10px] text-slate-500 mt-0.5">
                                                {selectedChange.status} · {selectedChange.taskCompleted}/{selectedChange.taskTotal} tasks
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <ActionButton icon={FileCheck} label="Validate" color="cyan" loading={running && currentAction === 'validate'} disabled={running} onClick={() => { setChangeId(selectedChange.name); runAction('validate'); }} />
                                            <ActionButton icon={Archive} label="Archive" color="amber" loading={running && currentAction === 'archive'} disabled={running} onClick={() => { setChangeId(selectedChange.name); runAction('archive'); }} />
                                        </div>
                                    </div>
                                    <SpecDiff changeName={selectedChange.name} projectRoot={effectiveCwd} />
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center flex flex-col items-center justify-center h-full min-h-[300px]">
                                    <GitCompare size={28} className="text-slate-600 mb-3" />
                                    <p className="text-xs text-slate-500 mb-1">Select a change to review</p>
                                    <p className="text-[10px] text-slate-600">Click any card to view its spec deltas and run validate / archive.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── DRIFT TAB ── */}
                {tab === 'drift' && (
                    <div className="max-w-3xl">
                        <SpecDriftPanel projectRoot={effectiveCwd} />
                    </div>
                )}

                {/* ── DIAGNOSTICS TAB ── */}
                {tab === 'diagnostics' && (
                    <div className="max-w-2xl space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <DiagRow label="Installation" ok={diagnostics?.installed} okText="Installed" failText="Missing" />
                            <DiagRow label="Version" ok={!!diagnostics?.version} okText={diagnostics?.version || '—'} failText="Unknown" />
                            <DiagRow label="openspec/config.yaml" ok={diagnostics?.projectRootFound} okText="Found" failText="Not found" />
                        </div>

                        {diagError && <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2 text-xs text-red-400">{diagError}</div>}
                        {diagnostics?.errors?.map((e, i) => (
                            <div key={i} className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2 text-xs text-red-400">{e}</div>
                        ))}

                        <div className="flex flex-wrap items-center gap-2">
                            <ActionButton icon={RefreshCw} label="Run Diagnostics" color="indigo" loading={diagLoading} disabled={diagLoading} onClick={runDiagnostics} />
                            {diagnostics && !diagnostics.installed && (
                                <ActionButton icon={Download} label="Install Now" color="amber" loading={running && currentAction === 'install'} disabled={running} onClick={handleInstall} />
                            )}
                            {diagnostics?.installed && !diagnostics?.projectRootFound && (
                                <ActionButton icon={Play} label="Initialize Project" color="emerald" loading={running && currentAction === 'init'} disabled={running} onClick={handleInit} />
                            )}
                        </div>

                        {/* Workflow readiness */}
                        <div className="rounded-xl border border-white/5 bg-black/25 p-4">
                            <div className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Workflow Readiness</div>
                            {[
                                ['CLI installed', diagnostics?.installed],
                                ['Project initialized', diagnostics?.projectRootFound],
                                ['Ready to validate & archive', diagnostics?.installed && diagnostics?.projectRootFound],
                            ].map(([label, ready]) => (
                                <div key={label} className="flex items-center gap-3 mb-2 text-[11px]">
                                    <span className="w-40 text-slate-400">{label}</span>
                                    <div className="flex-1 h-1.5 rounded-full bg-white/5"><div className={`h-full rounded-full ${ready ? 'bg-emerald-400' : 'bg-slate-700'}`} style={{width: ready ? '100%' : '15%'}} /></div>
                                    <span className={ready ? 'text-emerald-300' : 'text-slate-600'}>{ready ? 'Yes' : 'No'}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── COMMANDS TAB ── */}
                {tab === 'commands' && (
                    <div className="max-w-2xl space-y-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Change / Spec Name</label>
                            <input type="text" value={changeId} onChange={e => setChangeId(e.target.value)}
                                placeholder="e.g. add-auth-middleware"
                                className="w-full rounded-xl bg-black/35 border border-white/10 px-4 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors" />
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <ActionButton icon={FileCheck} label="Validate" color="cyan" loading={running && currentAction === 'validate'} disabled={running || !changeId} onClick={() => runAction('validate')} />
                            <ActionButton icon={Archive} label="Archive" color="amber" loading={running && currentAction === 'archive'} disabled={running || !changeId} onClick={() => runAction('archive')} />
                            <ActionButton icon={RefreshCw} label="List Changes" color="indigo" loading={running && currentAction === 'list'} disabled={running} onClick={() => runAction('list')} />
                            <ActionButton icon={FileCheck} label="List Specs" color="emerald" loading={running && currentAction === 'list'} disabled={running} onClick={() => runAction('list', { specs: true })} />
                        </div>

                        {/* Console output */}
                        <div className="rounded-xl bg-black/50 border border-white/5 p-4 h-80 overflow-y-auto custom-scrollbar font-mono">
                            {consoleLines.length === 0 ? (
                                <div className="text-xs text-slate-600 italic">Run a command to see output here...</div>
                            ) : (
                                consoleLines.map((line, i) => <ConsoleLine key={`${line.ts}-${i}`} text={line.text} type={line.type} />)
                            )}
                            <div ref={consoleEndRef} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
