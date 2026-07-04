import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Zap,
    Activity,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Play,
    FileCheck,
    Rocket,
    Archive,
    FolderOpen,
    Terminal,
    Download,
    RefreshCw,
    ChevronDown,
    ChevronRight,
    Loader2,
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
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [specPath, setSpecPath] = useState('');
    const [dryRun, setDryRun] = useState(true);
    const [cwd, setCwd] = useState('');
    const [running, setRunning] = useState(false);
    const [currentAction, setCurrentAction] = useState(null);

    // Console output
    const [consoleLines, setConsoleLines] = useState([]);
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
                title: title || undefined,
                description: description || undefined,
                specPath: specPath || undefined,
                projectRoot: effectiveCwd || undefined,
                dryRun: action === 'apply' || action === 'propose' ? dryRun : undefined,
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

    // ── Render ──

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
                                label="openspec/project.md"
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
                        </div>
                    </div>
                </CollapsibleSection>

                {/* ── Command Input Area ── */}
                <CollapsibleSection title="Commands" icon={Terminal}>
                    <div className="space-y-4">
                        {/* Text inputs */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <InputField
                                label="Change ID"
                                value={changeId}
                                onChange={setChangeId}
                                placeholder="e.g. add-auth-middleware"
                            />
                            <InputField
                                label="Spec Path"
                                value={specPath}
                                onChange={setSpecPath}
                                placeholder="e.g. openspec/specs/auth.md"
                            />
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                            <InputField
                                label="Title"
                                value={title}
                                onChange={setTitle}
                                placeholder="Brief title for the proposed change"
                            />
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Description</label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Detailed description of the change..."
                                    rows={2}
                                    className="w-full rounded-xl bg-black/35 border border-white/10 px-4 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-colors resize-none"
                                />
                            </div>
                        </div>

                        {/* Workflow action buttons */}
                        <div className="flex flex-wrap items-center gap-2">
                            <ActionButton
                                icon={Play}
                                label="Propose"
                                color="indigo"
                                loading={running && currentAction === 'propose'}
                                disabled={running || !title || !description || !specPath}
                                onClick={() => runAction('propose')}
                            />
                            <span className="text-slate-600 text-xs">➜</span>
                            <ActionButton
                                icon={FileCheck}
                                label="Validate"
                                color="cyan"
                                loading={running && currentAction === 'validate'}
                                disabled={running || !changeId}
                                onClick={() => runAction('validate')}
                            />
                            <span className="text-slate-600 text-xs">➜</span>
                            <ActionButton
                                icon={Rocket}
                                label="Apply"
                                color="emerald"
                                loading={running && currentAction === 'apply'}
                                disabled={running || !changeId}
                                onClick={() => runAction('apply')}
                            />
                            <span className="text-slate-600 text-xs">➜</span>
                            <ActionButton
                                icon={Archive}
                                label="Archive"
                                color="amber"
                                loading={running && currentAction === 'archive'}
                                disabled={running || !changeId}
                                onClick={() => runAction('archive')}
                            />
                        </div>

                        {/* Extra actions row */}
                        <div className="flex flex-wrap items-center gap-2">
                            <ActionButton
                                icon={RefreshCw}
                                label="List Changes"
                                color="slate"
                                size="sm"
                                loading={running && currentAction === 'list'}
                                disabled={running}
                                onClick={() => runAction('list')}
                            />
                        </div>

                        {/* Options row */}
                        <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-white/5">
                            {/* Dry-run toggle */}
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <div className="relative">
                                    <input
                                        type="checkbox"
                                        checked={dryRun}
                                        onChange={(e) => setDryRun(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="h-5 w-9 rounded-full bg-white/10 peer-checked:bg-amber-500/30 border border-white/10 peer-checked:border-amber-500/50 transition-colors"></div>
                                    <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-slate-400 peer-checked:bg-amber-400 transition-transform peer-checked:translate-x-4"></div>
                                </div>
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                    Dry Run {dryRun ? 'ON' : 'OFF'}
                                </span>
                            </label>

                            {/* Working directory */}
                            <div className="flex items-center gap-2">
                                <FolderOpen size={12} className="text-slate-500" />
                                <input
                                    type="text"
                                    value={cwd}
                                    onChange={(e) => setCwd(e.target.value)}
                                    placeholder={selectedProject?.path || process.cwd?.() || 'Workspace root'}
                                    className="flex-1 min-w-[200px] rounded-lg bg-black/35 border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors font-mono"
                                />
                            </div>
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
                            <button
                                onClick={clearConsole}
                                className="text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:text-slate-400 transition-colors"
                            >
                                Clear
                            </button>
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
