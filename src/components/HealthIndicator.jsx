/**
 * HealthIndicator — Dot with color showing overall system health.
 *
 * Usage:
 *   <HealthIndicator checks={health.checks} />
 *
 * Green  = all ok
 * Yellow = running degraded
 * Red    = error fetching
 * Gray   = loading
 */
export default function HealthIndicator({ checks, className = '' }) {
    if (!checks) {
        return (
            <span className={`inline-block w-2 h-2 rounded-full bg-slate-600 animate-pulse ${className}`}
                  title="Checking dependencies..." />
        )
    }

    const entries = Object.values(checks).filter(Boolean)
    const allOk = entries.length > 0 && entries.every(c => c && c.ok === true)
    const anyFail = entries.some(c => c && c.ok === false)

    let color, title
    if (allOk) {
        color = 'bg-emerald-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
        title = 'All systems OK'
    } else if (anyFail) {
        color = 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]'
        title = 'Degraded — some dependencies missing'
    } else {
        color = 'bg-slate-500'
        title = 'Checking...'
    }

    return <span className={`inline-block w-2 h-2 rounded-full ${color} ${className}`} title={title} />
}
