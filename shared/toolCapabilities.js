/**
 * Which tools may run without asking, and which must stop for consent.
 *
 * The product's headline promise is that every write pauses for a diff. It was
 * not true. The gate fired on one hardcoded name:
 *
 *     if (toolCall.name === 'writeFile')
 *
 * `applyPatch` writes to disk and had no approval branch at all — and the
 * writeFile description actively steered the model away from the gated path:
 * "Requires human approval, so prefer applyPatch for edits to existing files."
 *
 * Measured, not theorised: asking the agent to edit a file without naming a
 * tool changed `original contents` to `REPLACED` on disk with no
 * awaiting_approval event anywhere in the stream. The approval smoke test
 * passed throughout, because it says "Use the writeFile tool" — it tested the
 * one path that happened to be gated.
 *
 * So the decision is inverted. Read-only tools are named explicitly; everything
 * else requires approval. A tool added tomorrow is gated until someone
 * deliberately declares it safe, which is the direction this should fail in.
 */

/**
 * Built-in tools that only read. Adding a name here is a claim that the tool
 * cannot change the workspace, the machine, or the agent's own state.
 */
const READ_ONLY_TOOLS = [
    'readFile',
    'listFiles',
    'searchCode',
    'searchCodeFilesystem',
    'impactOf',
    'graphifyQuery',
    'graphifyExplain',
    'graphifyPath',
    'graphifyAffected',
    'specDrift',
    'specValidate'
];

/**
 * Plugin permissions that imply a change to something.
 *
 * Compared by exact membership, never substring: an earlier capability label
 * matched `audit:write` on the substring "write" and told users a read-only
 * plugin could modify their files. A label that overstates is worse than none,
 * and here it would also gate tools that need no gate. Every entry is spelled
 * out in full for that reason.
 */
const MUTATING_PERMISSIONS = [
    'write',
    'unrestricted',
    'command',
    'audit:write',
    'agent:invoke',
    'task:create',
    'filesystem:write'
];

/**
 * Does this tool call need a human decision before it runs?
 *
 * @param {string} toolName - The tool the model asked for.
 * @param {{permissions?: string[]}} [descriptor] - A plugin's declared
 *   permissions, when the tool is a plugin rather than a built-in.
 * @returns {boolean} True when the call must pause for approval.
 */
function requiresApproval(toolName, descriptor = {}) {
    const permissions = descriptor && descriptor.permissions;

    // A plugin describes its own capabilities, so believe the declaration. An
    // empty or absent list is not a claim of safety, so it falls through to the
    // allowlist below rather than being treated as read-only.
    if (Array.isArray(permissions) && permissions.length > 0) {
        return permissions.some((permission) => MUTATING_PERMISSIONS.includes(permission));
    }

    return !READ_ONLY_TOOLS.includes(toolName);
}

/** True when the tool is on the read-only allowlist. */
function isReadOnlyTool(toolName) {
    return READ_ONLY_TOOLS.includes(toolName);
}

module.exports = {
    READ_ONLY_TOOLS,
    MUTATING_PERMISSIONS,
    requiresApproval,
    isReadOnlyTool
};
