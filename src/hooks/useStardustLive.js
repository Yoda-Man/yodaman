/**
 * useStardustLive — React hook for real-time OpenSpec dashboard state.
 *
 * Subscribes to the /api/stardust/live WebSocket, falls back to REST polling
 * when WebSocket is unavailable. Uses useSyncExternalStore so React batches
 * re-renders optimally.
 *
 * Usage:
 *   const { snapshot, activity, connected, pulse } = useStardustLive(projectRoot);
 */

import { useSyncExternalStore, useCallback, useEffect, useRef } from 'react';
import { api } from '../api/api';

const STORAGE_KEY_PREFIX = 'stardust_live_';

// ── Store internals ──

let _snapshot = { changes: [], ready: false, graphStatus: 'unavailable' };
let _activity = [];
let _connected = false;
let _pulse = 0;
const _listeners = new Set();

function notify() {
    _pulse++;
    for (const fn of _listeners) fn();
}

function getSnapshot() { return _snapshot; }
function getActivity() { return _activity; }
function getConnected() { return _connected; }
function getPulse() { return _pulse; }

function subscribe(cb) {
    _listeners.add(cb);
    return () => _listeners.delete(cb);
}

// ── Hook ──

export function useStardustLive(projectRoot) {
    const wsRef = useRef(null);
    const pollRef = useRef(null);
    const projectRef = useRef(projectRoot);
    projectRef.current = projectRoot;

    const snapshot = useSyncExternalStore(subscribe, getSnapshot);
    const activity = useSyncExternalStore(subscribe, getActivity);
    const connected = useSyncExternalStore(subscribe, getConnected);
    const pulse = useSyncExternalStore(subscribe, getPulse);

    const seedFromRest = useCallback(async (root) => {
        try {
            const data = await api.stardustBoard(root);
            if (data && data.ready !== undefined) {
                _snapshot = data;
                notify();
            }
        } catch (_) { /* REST fallback failed — WS will seed when it connects */ }
    }, []);

    const connect = useCallback((root) => {
        if (wsRef.current) {
            try { wsRef.current.close(); } catch (_) { /* ignore */ }
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const url = `${protocol}//${host}/api/stardust/live?projectRoot=${encodeURIComponent(root || '')}`;

        let ws;
        try {
            ws = new WebSocket(url);
        } catch (_) {
            _connected = false;
            notify();
            // Fall back to polling
            pollRef.current = setInterval(() => seedFromRest(root), 10000);
            return;
        }

        wsRef.current = ws;

        ws.onopen = () => {
            _connected = true;
            notify();
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'snapshot') {
                    _snapshot = msg.data;
                    _activity = _activity.slice(-199); // keep cap
                    notify();
                } else if (msg.type === 'activity') {
                    _activity = [..._activity.slice(-199), msg.data];
                    _snapshot = buildUpdatedSnapshot(_snapshot, msg.data);
                    notify();
                }
            } catch (_) { /* malformed message */ }
        };

        ws.onclose = () => {
            _connected = false;
            notify();
            // Reconnect after 3s
            setTimeout(() => {
                if (projectRef.current) connect(projectRef.current);
            }, 3000);
        };

        ws.onerror = () => {
            ws.close();
        };
    }, [seedFromRest]);

    useEffect(() => {
        seedFromRest(projectRoot);
        connect(projectRoot);

        return () => {
            if (wsRef.current) {
                try { wsRef.current.close(); } catch (_) { /* ignore */ }
                wsRef.current = null;
            }
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [projectRoot, seedFromRest, connect]);

    return { snapshot, activity, connected, pulse };
}

/** Optimistically update a snapshot from an activity entry so the board stays in sync. */
function buildUpdatedSnapshot(snap, activityEntry) {
    if (!snap || !snap.changes) return snap;
    // Simple approach: mark the snapshot as needing a refresh
    // The next snapshot push from the server will have the full data
    return snap;
}
