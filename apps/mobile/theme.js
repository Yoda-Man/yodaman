/**
 * LOAD-BEARING — DO NOT DELETE BECAUSE "NOTHING IMPORTS IT" IS WRONG HERE.
 * App.js imports this; both are reached by the Expo runtime, not by anything
 * in the core package's import graph.
 *
 * The mobile palette is a direct port of the desktop theme in
 * `core/src/index.css`. Values are copied, not re-picked: the two clients are
 * one product, and a phone that renders a different indigo reads as a
 * different app. Update this file when that stylesheet changes.
 *
 * The faction colours are semantic, not decorative — the same vocabulary the
 * desktop uses:
 *   holocron — the knowledge graph, VR, anything projected
 *   imperial — specs and warnings, and anything awaiting a decision
 *   sith     — destructive actions and high risk
 *   jedi     — healthy, current, approved
 */
import { Platform } from 'react-native';

export const colors = {
    bgPrimary: '#020617',
    bgSecondary: '#0f172a',
    panel: 'rgba(15, 23, 42, 0.6)',
    panelSolid: '#0f172a',
    inputBg: 'rgba(2, 6, 23, 0.5)',

    accent: '#6366f1',
    accentStrong: '#4f46e5',
    accentSecondary: '#8b5cf6',

    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    textFaint: '#64748b',
    placeholder: '#475569',

    border: 'rgba(255, 255, 255, 0.08)',
    borderFaint: 'rgba(255, 255, 255, 0.05)',

    holocron: '#22d3ee',
    holocronDim: 'rgba(34, 211, 238, 0.14)',
    imperial: '#f0a92e',
    imperialDim: 'rgba(240, 169, 46, 0.14)',
    sith: '#f43f5e',
    sithDim: 'rgba(244, 63, 94, 0.14)',
    jedi: '#34d399',
    jediDim: 'rgba(52, 211, 153, 0.14)'
};

// Inter, Outfit and JetBrains Mono are self-hosted on the desktop through
// Fontsource, which ships woff2 only — a format React Native cannot load. Until
// the TTFs are vendored, the system UI face carries the body text and the
// platform monospace carries the readout, which is the part of the desktop
// look that actually depends on the typeface.
export const fonts = {
    mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })
};

export const radius = { sm: 8, md: 12, lg: 16 };

/** The wide-tracked monospace label used across desktop cockpit panels. */
export const readout = {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.textFaint
};

/** Map a runtime task status onto the faction vocabulary. */
export function statusColor(status) {
    switch (status) {
        case 'completed':
        case 'succeeded':
        case 'approved':
            return colors.jedi;
        case 'awaiting_approval':
            return colors.imperial;
        case 'failed':
        case 'error':
        case 'cancelled':
            return colors.sith;
        case 'running':
        case 'cancelling':
            return colors.holocron;
        default:
            return colors.textFaint;
    }
}
