/**
 * LOAD-BEARING — reached by App.js, which the Expo runtime resolves by
 * convention. Nothing in the core package imports either file.
 *
 * Presentation primitives ported from the desktop's @layer components block in
 * `core/src/index.css`: Card mirrors .glass-panel, Readout mirrors .readout,
 * PrimaryButton/SecondaryButton mirror .btn-primary/.btn-secondary, and
 * HudFrame mirrors .hud-frame — the corner brackets the desktop reserves for
 * moments where the user is asked to assess something before committing.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, readout } from './theme';

export function Readout({ children, style }) {
    return <Text style={[styles.readout, style]}>{children}</Text>;
}

export function Card({ children, style }) {
    return <View style={[styles.card, style]}>{children}</View>;
}

export function Section({ title, hint, children, right }) {
    return (
        <Card>
            <View style={styles.sectionHead}>
                <Readout>{title}</Readout>
                {right || null}
            </View>
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}
            {children}
        </Card>
    );
}

/** Corner brackets, as on a targeting display. Brackets only — no full border. */
export function HudFrame({ children, tone = colors.imperial, style }) {
    return (
        <View style={[styles.hudFrame, style]}>
            <View style={[styles.bracket, styles.bracketTL, { borderColor: tone }]} />
            <View style={[styles.bracket, styles.bracketTR, { borderColor: tone }]} />
            <View style={[styles.bracket, styles.bracketBL, { borderColor: tone }]} />
            <View style={[styles.bracket, styles.bracketBR, { borderColor: tone }]} />
            {children}
        </View>
    );
}

export function Pill({ label, tone = colors.textFaint, dim }) {
    return (
        <View style={[styles.pill, { backgroundColor: dim || 'transparent', borderColor: tone }]}>
            <View style={[styles.dot, { backgroundColor: tone }]} />
            <Text style={[styles.pillText, { color: tone }]}>{label}</Text>
        </View>
    );
}

export function PrimaryButton({ disabled, label, onPress, tone = colors.accentStrong, busy }) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !!disabled }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.button,
                { backgroundColor: tone },
                disabled ? styles.buttonDisabled : null,
                pressed && !disabled ? styles.buttonPressed : null
            ]}
        >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.buttonText}>{label}</Text>}
        </Pressable>
    );
}

export function SecondaryButton({ label, onPress, disabled, tone }) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !!disabled }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.secondaryButton,
                tone ? { borderColor: tone } : null,
                disabled ? styles.buttonDisabled : null,
                pressed && !disabled ? styles.buttonPressed : null
            ]}
        >
            <Text style={[styles.secondaryButtonText, tone ? { color: tone } : null]}>{label}</Text>
        </Pressable>
    );
}

export function EmptyState({ text }) {
    return <Text style={styles.empty}>{text}</Text>;
}

export function KeyValue({ label, value, tone }) {
    return (
        <View style={styles.kv}>
            <Text style={styles.kvLabel}>{label}</Text>
            <Text style={[styles.kvValue, tone ? { color: tone } : null]} numberOfLines={2}>{String(value)}</Text>
        </View>
    );
}

export function Mono({ children, style }) {
    return <Text style={[styles.mono, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
    readout: { ...readout },
    card: {
        backgroundColor: colors.panelSolid,
        borderColor: colors.borderFaint,
        borderWidth: 1,
        borderRadius: radius.lg,
        padding: 16,
        gap: 10
    },
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    hint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
    hudFrame: { position: 'relative', padding: 14, gap: 8 },
    bracket: { position: 'absolute', width: 12, height: 12 },
    bracketTL: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2 },
    bracketTR: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2 },
    bracketBL: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2 },
    bracketBR: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2 },
    pill: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4
    },
    dot: { width: 6, height: 6, borderRadius: 3 },
    pillText: { ...readout, color: undefined, fontSize: 9 },
    button: {
        borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 16,
        alignItems: 'center', justifyContent: 'center', minHeight: 46
    },
    buttonDisabled: { opacity: 0.4 },
    buttonPressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
    buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
    secondaryButton: {
        borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 16,
        alignItems: 'center', justifyContent: 'center', minHeight: 44,
        backgroundColor: 'rgba(30, 41, 59, 0.5)',
        borderWidth: 1, borderColor: colors.borderFaint
    },
    secondaryButtonText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    empty: { color: colors.placeholder, fontSize: 12, fontStyle: 'italic' },
    kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 3 },
    kvLabel: { color: colors.textFaint, fontSize: 12, flexShrink: 0 },
    kvValue: { color: colors.textPrimary, fontSize: 12, flexShrink: 1, textAlign: 'right' },
    mono: { fontFamily: fonts.mono, color: colors.textSecondary, fontSize: 11, lineHeight: 16 }
});
