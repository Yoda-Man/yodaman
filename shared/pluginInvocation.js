/**
 * LOAD-BEARING — DO NOT DELETE BECAUSE "NOTHING IMPORTS IT" IS WRONG HERE.
 * Imported by src/components/AgentChatTab.jsx (through Vite) and by
 * scripts/plugin-smoke.js (through require).
 *
 * How a plugin becomes text in the chat composer.
 *
 * This lives in shared/ so the UI and the release gate cannot disagree. If the
 * dropdown inserts one phrase and the pre-ship test exercises another, the test
 * stops describing what users actually do — which is the exact failure that let
 * a completely broken agent tool-call path ship in 0.4.5.
 */

/**
 * The phrase to insert for a plugin.
 *
 * Plugins document example phrases in a `💡 Chat usage:` hint. Prefer the
 * explicit "Run <plugin>" form: the conversational phrasings exist for people
 * who do not know the plugin exists, but choosing it from a menu is already
 * that discovery, and by then what you want is the invocation that lands.
 * Picking the first hint instead made the agent answer "How many lines of
 * code?" by searching for documentation about code size.
 */
function pluginInvocation(plugin) {
    const description = (plugin && plugin.description) || '';
    const hintIndex = description.indexOf('Chat usage:');
    if (hintIndex !== -1) {
        const quoted = [...description.slice(hintIndex).matchAll(/"([^"]+)"/g)]
            .map((match) => match[1].trim())
            .filter(Boolean);

        const explicit = quoted.find((phrase) => /^run\b/i.test(phrase));
        if (explicit) return explicit;
        if (quoted.length) return quoted[0];
    }
    return `Run ${(plugin && plugin.name) || 'plugin'}`;
}

/**
 * A short, literal statement of what a plugin's permissions allow, or null.
 *
 * Mapped explicitly against PLUGIN_PERMISSION_ALLOWLIST in ToolBox.js, which is
 * a closed set. Pattern-matching the strings instead flagged `audit:write` — the
 * audit log, nothing else — and so described a VR graph viewer as able to change
 * your code. A label that overstates is worse than none: it teaches people to
 * ignore the one that matters. Ordered by consequence.
 */
const PLUGIN_CAPABILITY_LABELS = [
    ['unrestricted', 'unrestricted'],
    ['write', 'writes files'],
    ['command', 'runs commands'],
    ['agent:invoke', 'starts agent tasks'],
    ['task:create', 'starts agent tasks'],
    ['network', 'network access']
];

function pluginCapability(plugin) {
    const permissions = Array.isArray(plugin && plugin.permissions) ? plugin.permissions : [];
    const match = PLUGIN_CAPABILITY_LABELS.find(([permission]) => permissions.includes(permission));
    return match ? match[1] : null;
}

module.exports = { pluginInvocation, pluginCapability, PLUGIN_CAPABILITY_LABELS };
