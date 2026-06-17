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
import { useState } from 'react'
import useHealthCheck from '../hooks/useHealthCheck'
import HealthIndicator from './HealthIndicator'

const CHECK_LABELS = {
    node:     { label: 'Node.js',      icon: '⬡' },
    runtime:  { label: 'Runtime',      icon: '⚙' },
    graphify: { label: 'Graphify',     icon: '◈' },
    ollama:   { label: 'Ollama',       icon: '◇' },
    ctx:      { label: 'Context Expert', icon: '⊡' },
    config:   { label: 'Config',       icon: '⚐' },
}

export default function HealthDashboard({ compact = false }) {
    const { checks, services, status, loading, error, refresh } = useHealthCheck()
    const [copiedKey, setCopiedKey] = useState(null)

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
