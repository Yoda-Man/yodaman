import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Zap,
    Activity,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Play,
    FileCheck,
    Archive,
    FolderOpen,
    Terminal,
    Download,
    RefreshCw,
    ChevronDown,
    ChevronRight,
    Loader2,
    Clipboard,
    ClipboardCheck,
    BarChart3,
} from 'lucide-react';
import { api } from '../api/api';

// ── Color map for console output ──
const LINE_COLORS = {
    success: 'text-emerald-400',
    error: 'text-red-400',
    warning: 'text-amber-400',
    info: 'text-cyan-300',
    default: 'text-slate-300',
};

function classifyLine(line) {
    const lower = line.toLowerCase();
    if (/error|fail|fatal|exception/i.test(lower)) return 'error';
    if (/warn|warning/i.test(lower)) return 'warning';
    if (/success|pass|ok|applied|archived|created/i.test(lower)) return 'success';
    if (/info|note|tip|hint/i.test(lower)) return 'info';
    return 'default';
}

// ── Sub-components ──

function ConsoleLine({ text, type }) {
    return (
        <div className={`font-mono text-xs leading-5 ${LINE_COLORS[type] || LINE_COLORS.default} whitespace-pre-wrap break-all`}>
            {text}
        </div>
    );
}

function CollapsibleSection({ title, icon: Icon, defaultOpen = true, children }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors"
            >
                <div className="flex items-center gap-2">
                    <Icon size={16} className="text-indigo-400" />
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-300">{title}</span>
                </div>
                {open ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
            </button>
            {open && <div className="px-5 pb-4">{children}</div>}
        </div>
    );
}

// ── Main Component ──

export default function Stardust({ selectedProject }) {
    // Diagnostics state
    const [diagnostics, setDiagnostics] = useState(null);
    const [diagLoading, setDiagLoading] = useState(false);
    const [diagError, setDiagError] = useState(null);

    // Command state
    const [changeId, setChangeId] = useState('');
    const [cwd, setCwd] = useState('');
    const [running, setRunning] = useState(false);
    const [currentAction, setCurrentAction] = useState(null);
    const [actionRuns, setActionRuns] = useState([]);

    // Console output
    const [consoleLines, setConsoleLines] = useState([]);
    const [verbose, setVerbose] = useState(false);
    const consoleEndRef = useRef(null);

    // Derive effective CWD
    const effectiveCwd = cwd || (selectedProject?.path) || '';

    // ── Helpers ──

    const appendConsole = useCallback((text, type) => {
        const lines = text.split('\n').filter(l => l.trim());
        setConsoleLines(prev => [
            ...prev,
            ...lines.map(l => ({ text: l, type: type || classifyLine(l), ts: Date.now() })),
        ]);
    }, []);

    const clearConsole = () => setConsoleLines([]);

    const copyConsole = () => {
        const text = consoleLines.map(l => l.text).join('\n');
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            // brief feedback handled by state below
        }).catch(() => {
            // fallback for non-HTTPS contexts
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    };

    // Auto-scroll console
    useEffect(() => {
        consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [consoleLines]);

    // ── Diagnostics ──

    const runDiagnostics = async () => {
        setDiagLoading(true);
        setDiagError(null);
        try {
            const result = await api.stardustDiagnose(effectiveCwd);
            setDiagnostics(result);
            appendConsole(
                `[DIAGNOSTICS] Installed: ${result.installed}, Version: ${result.version || 'N/A'}, Project: ${result.projectRootFound ? 'Found' : 'Not found'}`,
                'info'
            );
        } catch (err) {
            setDiagError(err.message);
            appendConsole(`[DIAGNOSTICS ERROR] ${err.message}`, 'error');
        } finally {
            setDiagLoading(false);
        }
    };

    // Run diagnostics on mount
    useEffect(() => {
        runDiagnostics();
    }, []);

    // ── Command runner ──

    const runAction = async (action, extra = {}) => {
        setRunning(true);
        setCurrentAction(action);
        appendConsole(`\n── ${action.toUpperCase()} ──`, 'info');

        try {
            const payload = {
                action,
                changeId: changeId || undefined,
                projectRoot: effectiveCwd || undefined,
                ...extra,
            };

            const result = await api.stardustRun(payload);

            if (result.stdout) {
                appendConsole(result.stdout, 'default');
            }
            if (result.stderr) {
                appendConsole(result.stderr, 'warning');
            }

            if (result.success) {
                appendConsole(`✓ ${action} completed successfully (exit code: ${result.exitCode})`, 'success');
            } else {
                appendConsole(`✗ ${action} failed (exit code: ${result.exitCode})`, 'error');
            }

            setActionRuns(prev => [...prev.slice(-11), { action: extra.specs ? 'list specs' : action, success: result.success, at: Date.now() }]);

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
        appendConsole('Installing @fission-ai/openspec globally via npm...', 'info');
        try {
            const result = await api.stardustRun({ action: 'install' });
            if (result.stdout) appendConsole(result.stdout, 'default');
            if (result.stderr) appendConsole(result.stderr, 'warning');
            if (result.success) {
                appendConsole('✓ Installation complete. Run diagnostics to verify.', 'success');
            } else {
                appendConsole('✗ Installation failed. Check the output above.', 'error');
            }
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
        appendConsole(`Initializing OpenSpec in ${effectiveCwd}...`, 'info');
        try {
            const result = await api.stardustRun({ action: 'init', projectRoot: effectiveCwd, tools: 'all' });
            if (result.stdout) appendConsole(result.stdout, 'default');
            if (result.stderr) appendConsole(result.stderr, 'warning');
            if (result.success) {
                appendConsole('✓ Project initialized. Run diagnostics to verify.', 'success');
                // Re-run diagnostics to refresh the panel
                runDiagnostics();
            } else {
                appendConsole('✗ Initialization failed. Check the output above.', 'error');
            }
        } catch (err) {
            appendConsole(`✗ Init error: ${err.message}`, 'error');
        } finally {
            setRunning(false);
            setCurrentAction(null);
        }
    };

    // ── Render ──

    // Empty state: no active workspace selected
    if (!selectedProject) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-[#020617] text-slate-300 selection:bg-indigo-500/30 px-8">
                <div className="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-6">
                    <Zap size={36} className="text-amber-400/60" />
                </div>
                <h1 className="text-2xl font-black tracking-tight text-white mb-2">
                    ⚡ Project Stardust
                </h1>
                <p className="text-sm text-slate-500 max-w-md text-center leading-relaxed">
                    The blueprints for your codebase.
                </p>
                <div className="mt-8 rounded-2xl border border-amber-500/10 bg-amber-500/[0.03] px-6 py-5 max-w-md text-center">
                    <FolderOpen size={28} className="text-amber-400/40 mx-auto mb-3" />
                    <p className="text-sm text-slate-400 font-medium mb-1">No active workspace selected</p>
                    <p className="text-xs text-slate-600 leading-relaxed">
                        Select a project from the sidebar to start using OpenSpec through the Stardust workflow. Once a workspace is active, you can run diagnostics, propose changes, validate specs, and apply or archive them.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-[#020617] text-slate-300 selection:bg-indigo-500/30">
            {/* Header */}
            <header className="shrink-0 px-8 pt-6 pb-4 border-b border-white/5">
                <div className="flex items-center gap-3 mb-1">
                    <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20">
                        <Zap size={20} className="text-amber-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight text-white">
                            ⚡ Project Stardust
                        </h1>
                        <p className="text-xs text-slate-500 mt-0.5">
                            The blueprints for your codebase.
                        </p>
                    </div>
                </div>
            </header>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-5 space-y-5">
                {/* ── Diagnostics Panel ── */}
                <CollapsibleSection title="Diagnostics" icon={Activity}>
                    <div className="space-y-3">
                        {/* Status rows */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <DiagRow
                                label="Installation"
                                ok={diagnostics?.installed}
                                okText="Installed"
                                failText="Missing"
                            />
                            <DiagRow
                                label="Version"
                                ok={!!diagnostics?.version}
                                okText={diagnostics?.version || '—'}
                                failText="Unknown"
                            />
                            <DiagRow
                                label="openspec/config.yaml"
                                ok={diagnostics?.projectRootFound}
                                okText="Found"
                                failText="Not found"
                            />
                        </div>

                        {/* Errors */}
                        {diagError && (
                            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2 text-xs text-red-400">
                                {diagError}
                            </div>
                        )}
                        {diagnostics?.errors?.length > 0 && diagnostics.errors.map((e, i) => (
                            <div key={i} className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2 text-xs text-red-400">
                                {e}
                            </div>
                        ))}

                        {/* Verbose debug toggle */}
                        {diagnostics?._debug && (
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 cursor-pointer select-none relative">
                                    <input
                                        type="checkbox"
                                        checked={verbose}
                                        onChange={(e) => setVerbose(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="h-4 w-7 rounded-full bg-white/10 peer-checked:bg-cyan-500/30 border border-white/10 peer-checked:border-cyan-500/50 transition-colors"></div>
                                    <div className="absolute h-3 w-3 rounded-full bg-slate-400 peer-checked:bg-cyan-400 transition-transform peer-checked:translate-x-3"></div>
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Verbose Debug</span>
                                </label>
                                {verbose && (
                                    <div className="rounded-xl bg-black/40 border border-white/5 p-3 space-y-2 font-mono text-[11px]">
                                        <div className="text-slate-400">Binary: <span className="text-cyan-300">{diagnostics.binary}</span></div>
                                        <div className="text-slate-400">Version exit code: <span className={diagnostics._debug.versionExitCode === 0 ? 'text-emerald-400' : 'text-red-400'}>{diagnostics._debug.versionExitCode ?? 'N/A'}</span></div>
                                        <div>
                                            <div className="text-slate-500 mb-1">Raw stdout:</div>
                                            <pre className="text-emerald-300/70 whitespace-pre-wrap break-all">{diagnostics._debug.versionRawStdout || '(empty)'}</pre>
                                        </div>
                                        <div>
                                            <div className="text-slate-500 mb-1">Raw stderr:</div>
                                            <pre className="text-amber-300/70 whitespace-pre-wrap break-all">{diagnostics._debug.versionRawStderr || '(empty)'}</pre>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                onClick={runDiagnostics}
                                disabled={diagLoading}
                                className="flex items-center gap-1.5 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-indigo-300 transition-all hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:text-white disabled:opacity-50"
                            >
                                {diagLoading ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <RefreshCw size={14} />
                                )}
                                Run Diagnostics
                            </button>
                            {diagnostics && !diagnostics.installed && (
                                <button
                                    onClick={handleInstall}
                                    disabled={running}
                                    className="flex items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-amber-300 transition-all hover:border-amber-400/50 hover:bg-amber-500/20 hover:text-white disabled:opacity-50"
                                >
                                    {running && currentAction === 'install' ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                        <Download size={14} />
                                    )}
                                    Install Now
                                </button>
                            )}
                            {diagnostics && diagnostics.installed && !diagnostics.projectRootFound && (
                                <button
                                    onClick={handleInit}
                                    disabled={running}
                                    className="flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-emerald-300 transition-all hover:border-emerald-400/50 hover:bg-emerald-500/20 hover:text-white disabled:opacity-50"
                                >
                                    {running && currentAction === 'init' ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                        <Play size={14} />
                                    )}
                                    Initialize Project
                                </button>
                            )}
                        </div>
                    </div>
                </CollapsibleSection>

                {/* ── Command Input Area ── */}
                <CollapsibleSection title="Commands" icon={Terminal}>
                    <div className="space-y-4">
                        {/* Change ID input */}
                        <div className="grid grid-cols-1 gap-3">
                            <InputField
                                label="Change / Spec Name"
                                value={changeId}
                                onChange={setChangeId}
                                placeholder="e.g. add-auth-middleware"
                            />
                        </div>

                        {/* Workflow action buttons */}
                        <div className="flex flex-wrap items-center gap-2">
                            <ActionButton
                                icon={FileCheck}
                                label="Validate"
                                color="cyan"
                                loading={running && currentAction === 'validate'}
                                disabled={running || !changeId}
                                onClick={() => runAction('validate')}
                            />
                            <ActionButton
                                icon={Archive}
                                label="Archive"
                                color="amber"
                                loading={running && currentAction === 'archive'}
                                disabled={running || !changeId}
                                onClick={() => runAction('archive')}
                            />
                            <ActionButton
                                icon={RefreshCw}
                                label="List Changes"
                                color="indigo"
                                loading={running && currentAction === 'list'}
                                disabled={running}
                                onClick={() => runAction('list')}
                            />
                            <ActionButton
                                icon={FileCheck}
                                label="List Specs"
                                color="emerald"
                                loading={running && currentAction === 'list'}
                                disabled={running}
                                onClick={() => runAction('list', { specs: true })}
                            />
                        </div>

                        {/* Working directory */}
                        <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                                <FolderOpen size={12} className="text-slate-500" />
                                <input
                                    type="text"
                                    value={cwd}
                                    onChange={(e) => setCwd(e.target.value)}
                                    placeholder={selectedProject?.path || 'Workspace root'}
                                    className="flex-1 min-w-[200px] rounded-lg bg-black/35 border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors font-mono"
                                />
                            </div>
                    </div>
                </CollapsibleSection>

                <CollapsibleSection title="OpenSpec Insights" icon={BarChart3}>
                    <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border border-white/5 bg-black/25 p-4">
                            <div className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Workflow readiness</div>
                            <div className="space-y-3">
                                {[
                                    ['CLI installed', diagnostics?.installed],
                                    ['Project initialized', diagnostics?.projectRootFound],
                                    ['Ready to list, validate and archive', diagnostics?.installed && diagnostics?.projectRootFound],
                                ].map(([label, ready]) => (
                                    <div key={label} className="grid grid-cols-[170px_1fr_36px] items-center gap-3 text-[11px]">
                                        <span className="truncate text-slate-400">{label}</span>
                                        <div className="h-2 overflow-hidden rounded-full bg-white/5"><div className={`h-full rounded-full ${ready ? 'bg-emerald-400' : 'bg-slate-700'}`} style={{width: ready ? '100%' : '15%'}} /></div>
                                        <span className={ready ? 'text-emerald-300' : 'text-slate-600'}>{ready ? 'Yes' : 'No'}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="rounded-xl border border-white/5 bg-black/25 p-4">
                            <div className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Recent command outcomes</div>
                            {actionRuns.length ? (
                                <div className="flex h-24 items-end gap-2">
                                    {actionRuns.map((run, index) => <div key={`${run.at}-${index}`} className={`min-w-0 flex-1 rounded-t ${run.success ? 'bg-emerald-400/70' : 'bg-red-400/70'}`} style={{height: run.success ? '85%' : '40%'}} title={`${run.action}: ${run.success ? 'passed' : 'failed'}`} />)}
                                </div>
                            ) : <div className="flex h-24 items-center justify-center text-xs italic text-slate-600">Run an OpenSpec command to build this chart.</div>}
                            <div className="mt-3 flex gap-4 text-[10px] text-slate-500"><span><b className="text-emerald-400">●</b> Passed</span><span><b className="text-red-400">●</b> Failed</span></div>
                        </div>
                    </div>
                </CollapsibleSection>

                {/* ── Live Output Console ── */}
                <CollapsibleSection title="Output Console" icon={Terminal}>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                {consoleLines.length > 0 ? `${consoleLines.length} lines` : 'No output yet'}
                            </span>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={copyConsole}
                                    disabled={consoleLines.length === 0}
                                    className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-cyan-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    Copy
                                </button>
                                <button
                                    onClick={clearConsole}
                                    className="text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:text-slate-400 transition-colors"
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                        <div className="rounded-xl bg-black/50 border border-white/5 p-4 h-80 overflow-y-auto custom-scrollbar font-mono">
                            {consoleLines.length === 0 ? (
                                <div className="text-xs text-slate-600 italic">
                                    Run a command to see output here...
                                </div>
                            ) : (
                                consoleLines.map((line, i) => (
                                    <ConsoleLine key={`${line.ts}-${i}`} text={line.text} type={line.type} />
                                ))
                            )}
                            <div ref={consoleEndRef} />
                        </div>
                    </div>
                </CollapsibleSection>
            </div>
        </div>
    );
}

// ── Small helpers ──

function DiagRow({ label, ok, okText, failText }) {
    return (
        <div className="rounded-xl bg-black/25 border border-white/5 px-4 py-3 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
            <div className="flex items-center gap-1.5">
                {ok === undefined || ok === null ? (
                    <>
                        <Loader2 size={13} className="animate-spin text-slate-500" />
                        <span className="text-[11px] text-slate-500">Checking...</span>
                    </>
                ) : ok ? (
                    <>
                        <CheckCircle2 size={13} className="text-emerald-400" />
                        <span className="text-[11px] font-mono text-emerald-400">{okText}</span>
                    </>
                ) : (
                    <>
                        <XCircle size={13} className="text-red-400" />
                        <span className="text-[11px] text-red-400">{failText}</span>
                    </>
                )}
            </div>
        </div>
    );
}

function InputField({ label, value, onChange, placeholder }) {
    return (
        <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</label>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-xl bg-black/35 border border-white/10 px-4 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-colors"
            />
        </div>
    );
}

function ActionButton({ icon: Icon, label, color, loading, disabled, onClick, size = 'md' }) {
    const colorMap = {
        indigo: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300 hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:text-white',
        cyan: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-500/20 hover:text-white',
        emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:border-emerald-400/50 hover:bg-emerald-500/20 hover:text-white',
        amber: 'border-amber-500/20 bg-amber-500/10 text-amber-300 hover:border-amber-400/50 hover:bg-amber-500/20 hover:text-white',
        slate: 'border-slate-500/20 bg-slate-500/10 text-slate-400 hover:border-slate-400/50 hover:bg-slate-500/20 hover:text-white',
    };

    const sizeMap = {
        sm: 'px-3 py-1.5 text-[10px]',
        md: 'px-5 py-2.5 text-xs',
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`inline-flex items-center gap-1.5 rounded-xl border font-bold uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed ${colorMap[color] || colorMap.indigo} ${sizeMap[size] || sizeMap.md}`}
        >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
            {label}
        </button>
    );
}
