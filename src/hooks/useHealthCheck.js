/**
 * useHealthCheck — Reusable React hook for polling /api/health.
 *
 * Returns:
 *   { checks, services, status, started, loading, error, refresh }
 *
 * Components import this instead of writing their own fetch logic.
 */
import { useState, useEffect, useCallback } from 'react'

const HEALTH_POLL_MS = 5000

export default function useHealthCheck() {
    const [health, setHealth] = useState({
        checks: null,
        services: null,
        status: 'loading',
        started: false,
        loading: true,
        error: null
    })

    const fetchHealth = useCallback(async () => {
        try {
            const res = await fetch('/api/health')
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            setHealth({
                checks: data.checks || {},
                services: data.services || {},
                status: data.status || 'unknown',
                started: data.started || false,
                loading: false,
                error: null
            })
        } catch (err) {
            setHealth(prev => ({
                ...prev,
                loading: false,
                error: err.message
            }))
        }
    }, [])

    useEffect(() => {
        fetchHealth()
        const interval = setInterval(fetchHealth, HEALTH_POLL_MS)
        return () => clearInterval(interval)
    }, [fetchHealth])

    return { ...health, refresh: fetchHealth }
}
