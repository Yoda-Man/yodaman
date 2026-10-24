/**
 * HealthDashboard — Full diagnostic table showing all dependency checks.
 *
 * Uses the useHealthCheck hook to poll /api/health automatically.
 * Can be embedded in any page — settings, dashboard, help, etc.
 *
 * Usage:
 *   import HealthDashboard from '../components/HealthDashboard'
 *   <HealthDashboard />
 *
 *   // Compact mode for sidebar:
 *   <HealthDashboard compact />
 */
import { useEffect, useState } from 'react'
import { api } from '../api/api'
import useHealthCheck from '../hooks/useHealthCheck'
import HealthIndicator from './HealthIndicator'

/**
 * What each dependency is FOR, not just its name.
 *
 * A list of seven tool names reads as seven walls. Naming what each unlocks
 * turns a missing one into "this feature is off" rather than "the product is
 * broken" — and it makes visible that Graphify alone is enough for the coverage
 * finding, which needs no model download. The runtime starts without any of
 * these; a missing tool disables its features and says so.
 */
const CHECK_LABELS = {
    node:     { label: 'Node.js',        icon: '⬡', unlocks: 'The runtime itself' },
    runtime:  { label: 'Runtime',        icon: '⚙', unlocks: 'Serving the API and UI' },
    graphify: { label: 'Graphify',       icon: '◈', unlocks: 'Knowledge graph, impact analysis, and the coverage finding' },
    ollama:   { label: 'Ollama',         icon: '◇', unlocks: 'Chat and agent tasks' },
    ctx:      { label: 'Context Expert', icon: '⊡', unlocks: 'Semantic code search' },
    openspec: { label: 'OpenSpec',       icon: '⚡', unlocks: 'Spec tracking — drift still reports coverage without it' },
    config:   { label: 'Config',         icon: '⚐', unlocks: 'Which workspaces are watched' },
}

export default function HealthDashboard({ compact = false, onRepaired }) {
    const { checks, services, _status, loading, error, refresh } = useHealthCheck()
    const [copiedKey, setCopiedKey] = useState(null)
    // The installs Repair would run (`yodaman setup`); asked only when something is wrong.
    const [plan, setPlan] = useState(null)
    const [repair, setRepair] = useState({ state: 'idle' })
    const degraded = Boolean(checks) && Object.keys(CHECK_LABELS).some(k => checks[k] && checks[k].ok === false)

    useEffect(() => {
        if (compact || !degraded) return
        api.getSetupPlan().then(setPlan).catch(() => setPlan(null))
    }, [compact, degraded])

    const runRepair = async () => {
        setRepair({ state: 'running' })
        try {
            const result = await api.repairSetup()
            setRepair({ state: result.failed.length || result.stillMissing.some(n => result.installed.some(s => s.name === n)) ? 'partial' : 'done', result })
        } catch (err) {
            setRepair({ state: 'failed', error: err.message })
        }
        refresh()
        api.getSetupPlan().then(setPlan).catch(() => setPlan(null))
        onRepaired?.()
    }

    const copyDetail = (key, text) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedKey(key)
            setTimeout(() => setCopiedKey(null), 1500)
        }).catch(() => {
            // Fallback for insecure contexts
            const ta = document.createElement('textarea')
            ta.value = text
            ta.style.position = 'fixed'
            ta.style.left = '-9999px'
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            ta.remove()
            setCopiedKey(key)
            setTimeout(() => setCopiedKey(null), 1500)
        })
    }

    if (loading) {
        return (
            <div className="text-slate-500 text-xs flex items-center gap-2 p-4">
                <span className="inline-block w-2 h-2 rounded-full bg-slate-600 animate-pulse" />
                Checking system health...
            </div>
        )
    }

    if (error && !checks) {
        return (
            <div className="text-red-400 text-xs p-4 border border-red-900/30 rounded-lg bg-red-950/20">
                <p className="font-bold mb-1">⚠ Health check failed</p>
                <p className="text-red-300/70">{error}</p>
                <button onClick={refresh}
                    className="mt-2 text-indigo-400 hover:text-indigo-300 underline text-[10px]">
                    Retry
                </button>
            </div>
        )
    }

    const checkKeys = Object.keys(CHECK_LABELS)
    const allOk = checks && checkKeys.every(k => checks[k] && checks[k].ok === true)

    if (compact) {
        // Compact: single-line summary with indicator dot
        return (
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <HealthIndicator checks={checks} />
                <span>{allOk ? 'All systems OK' : 'Degraded'}</span>
                {!allOk && (
                    <button onClick={refresh}
                        className="text-indigo-400 hover:text-indigo-300 underline ml-1">
                        Details
                    </button>
                )}
            </div>
        )
    }

    // Full: diagnostic table
    return (
        <div className="text-xs">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <HealthIndicator checks={checks} />
                    <span className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">
                        {allOk ? 'All Systems Operational' : 'System Health — Degraded'}
                    </span>
                </div>
                <button onClick={refresh}
                    className="text-indigo-400 hover:text-indigo-300 text-[10px] hover:underline">
                    ⟳ Refresh
                </button>
            </div>

            <div className="border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-[11px]">
                    <thead>
                        <tr className="bg-slate-900/50">
                            <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider">Dependency</th>
                            <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider">Status</th>
                            {!compact && <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider">Detail</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {checkKeys.map(key => {
                            const check = checks?.[key]
                            const meta = CHECK_LABELS[key]
                            if (!meta) return null

                            let statusIcon, statusClass
                            if (!check) {
                                statusIcon = '⟳'
                                statusClass = 'text-slate-600'
                            } else if (check.ok) {
                                statusIcon = '✓'
                                statusClass = 'text-emerald-400'
                            } else {
                                statusIcon = '✗'
                                statusClass = 'text-red-400'
                            }

                            // Append "running" for Ollama service
                            let detail = check?.message || 'waiting...'
                            if (key === 'ollama' && services?.ollama) {
                                detail += services.ollama.running
                                    ? ' (service running)'
                                    : ' (service not running)'
                            }

                            return (
                                <tr key={key} className="border-t border-slate-800/50 hover:bg-slate-900/30">
                                    <td className="px-3 py-2 text-slate-300">
                                        <span className="mr-2">{meta.icon}</span>
                                        {meta.label}
                                        {!compact && meta.unlocks && (
                                            <div className="text-[11px] text-slate-500 leading-tight mt-0.5 ml-5">
                                                {meta.unlocks}
                                            </div>
                                        )}
                                    </td>
                                    <td className={`px-3 py-2 font-semibold ${statusClass}`}>{statusIcon}</td>
                                    {!compact && (
                                        <td className="px-3 py-2 text-slate-500 max-w-[300px] truncate cursor-pointer hover:text-slate-300 group"
                                            onClick={() => copyDetail(key, detail)}
                                            title="Click to copy">
                                            {copiedKey === key ? (
                                                <span className="text-emerald-400 font-semibold">✓ Copied!</span>
                                            ) : (
                                                <span>{detail}</span>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            {plan?.automatic?.length || repair.state !== 'idle' ? (
                <RepairPanel plan={plan} repair={repair} onRepair={runRepair} />
            ) : null}

            {!allOk && (
                <div className="mt-3 p-3 bg-amber-950/20 border border-amber-900/30 rounded-lg text-[10px] text-amber-300">
                    <p className="font-semibold mb-1">Some dependencies need attention</p>
                    <ul className="list-disc list-inside text-amber-200/70 space-y-0.5">
                        {checkKeys.filter(k => checks?.[k] && !checks[k].ok).map(k => (
                            <li key={k}>
                                {CHECK_LABELS[k]?.label || k}: {checks[k].message}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}

/**
 * One-click `yodaman setup`: installs only the user-space tools (ctx, Graphify,
 * OpenSpec) by their fixed commands, then re-checks. Exported for tests.
 */
export function RepairPanel({ plan, repair, onRepair }) {
    const steps = plan?.automatic || []
    const running = repair.state === 'running'
    return (
        <div className="mt-3 p-3 rounded-lg border border-indigo-500/30 bg-indigo-950/30 text-[11px]" aria-live="polite">
            {steps.length ? (
                <>
                    <p className="font-semibold text-indigo-200 mb-1">YodaMan can fix this</p>
                    <ul className="mb-2 space-y-0.5 text-slate-400">
                        {steps.map(step => (
                            <li key={step.name}>{CHECK_LABELS[step.name]?.label || step.name}: <code className="text-slate-300">{step.command}</code></li>
                        ))}
                    </ul>
                    <button type="button" onClick={onRepair} disabled={running}
                        className="rounded-lg border border-indigo-400/40 bg-indigo-500/20 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-100 hover:bg-indigo-500/30 disabled:opacity-60">
                        {running ? 'Repairing… this can take a few minutes' : 'Repair'}
                    </button>
                </>
            ) : null}
            {repair.state === 'done' ? <p className="text-emerald-300">Repaired: {repair.result.installed.map(s => CHECK_LABELS[s.name]?.label || s.name).join(', ')} installed and working.</p> : null}
            {repair.state === 'partial' ? (
                <p className="text-amber-300 mt-1">
                    Repair did not finish{repair.result.failed.length ? `: ${repair.result.failed.map(f => `${f.name} (${f.error})`).join('; ')}` : ''}. Still missing: {repair.result.stillMissing.join(', ') || 'nothing'}. Run <code>yodaman setup</code> in a terminal to see the full output.
                </p>
            ) : null}
            {repair.state === 'failed' ? <p className="text-red-300 mt-1">Repair could not run: {repair.error}</p> : null}
        </div>
    )
}

