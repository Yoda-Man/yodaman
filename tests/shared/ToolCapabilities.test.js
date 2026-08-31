/**
 * Guards the decision of what may run without asking.
 *
 * The bug: the approval gate fired on one hardcoded name, `writeFile`.
 * `applyPatch` writes to disk and was never gated, and writeFile's own
 * description told the model "prefer applyPatch for edits to existing files" —
 * so the product steered the agent onto the ungated path. Asking the agent to
 * edit a file without naming a tool changed it on disk with no approval event.
 *
 * The approval smoke test passed the whole time, because it says "Use the
 * writeFile tool". It exercised the one path that happened to be gated.
 *
 * These tests assert the inversion holds: read-only tools are named, everything
 * else is gated, and a tool nobody has classified is gated by default.
 */
const fs = require('fs');
const path = require('path');
const { requiresApproval, isReadOnlyTool, READ_ONLY_TOOLS, MUTATING_PERMISSIONS } = require('../../shared/toolCapabilities');

describe('tool capabilities', () => {
    describe('tools that change something require approval', () => {
        it.each([
            ['writeFile', 'overwrites a file'],
            ['applyPatch', 'writes to disk — the bug this exists for'],
            ['executeCommand', 'runs a command on the machine'],
            ['specPropose', 'creates an OpenSpec change'],
            ['specArchive', 'moves an OpenSpec change']
        ])('%s (%s)', (tool) => {
            expect(requiresApproval(tool)).toBe(true);
        });
    });

    describe('read-only tools run without asking', () => {
        it.each([
            'readFile', 'listFiles', 'searchCode', 'impactOf',
            'graphifyQuery', 'graphifyExplain', 'graphifyPath', 'graphifyAffected',
            'specDrift', 'specValidate'
        ])('%s', (tool) => {
            expect(requiresApproval(tool)).toBe(false);
            expect(isReadOnlyTool(tool)).toBe(true);
        });
    });

    it('gates a tool nobody has classified', () => {
        // The direction this must fail in. A tool added tomorrow is gated until
        // someone deliberately declares it safe.
        expect(requiresApproval('someToolAddedNextWeek')).toBe(true);
        expect(requiresApproval('')).toBe(true);
        expect(requiresApproval(undefined)).toBe(true);
    });

    describe('plugins are judged by the permissions they declare', () => {
        it('lets the read-only analysis plugins run unprompted', () => {
            // These are chat-invokable and covered by the plugin journey gate;
            // gating them would hang that gate rather than protect anyone.
            expect(requiresApproval('CodeTrooper', { permissions: ['read'] })).toBe(false);
            expect(requiresApproval('graphify', { permissions: ['read', 'search'] })).toBe(false);
            expect(requiresApproval('lightsaber', { permissions: ['read', 'search'] })).toBe(false);
        });

        it('gates a plugin that declares a mutating permission', () => {
            expect(requiresApproval('holocron-vr', {
                permissions: ['graphify:read', 'audit:write', 'task:create']
            })).toBe(true);
        });

        it('does not treat an empty permission list as a claim of safety', () => {
            // Absent permissions is missing information, not a guarantee, so it
            // falls through to the allowlist rather than being trusted.
            expect(requiresApproval('mysteryPlugin', { permissions: [] })).toBe(true);
            expect(requiresApproval('readFile', { permissions: [] })).toBe(false);
        });
    });

    it('matches permissions exactly, never by substring', () => {
        // An earlier capability label matched `audit:write` on the substring
        // "write" and told users a read-only plugin could modify their files.
        // Here the same mistake would gate tools that need no gate.
        expect(MUTATING_PERMISSIONS).toContain('audit:write');
        expect(requiresApproval('x', { permissions: ['write:none'] })).toBe(false);
        expect(requiresApproval('x', { permissions: ['readwrite-docs'] })).toBe(false);
    });

    /**
     * The drift guard, mirroring IgnoredPaths: the gate must read this module
     * rather than re-deriving the decision, and must not fall back to the name
     * check it replaced.
     */
    it('the agent gates on capability, not on a tool name', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', 'backend', 'core', 'AgentReasoningEngine.js'),
            'utf8'
        );
        expect(source).toMatch(/require\(['"].*shared\/toolCapabilities['"]\)/);
        expect(source).toMatch(/requiresApproval\(toolCall\.name/);
        // The exact branch this replaced must not come back. Scoped to the
        // `if (...)` so it does not fire on proposedContent's switch on the same
        // name, which decides how to render a diff rather than whether to gate.
        expect(source).not.toMatch(/if\s*\(\s*toolCall\.name === ['"]writeFile['"]\s*\)/);
    });

    it('no longer advertises applyPatch as the way to avoid approval', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', 'backend', 'infrastructure', 'ToolBox.js'),
            'utf8'
        );
        // Advice to route around consent, shipped in the tool description the
        // model reads on every task.
        expect(source).not.toMatch(/Requires human approval, so prefer applyPatch/);
    });

    it('every read-only entry is a real ToolBox tool', () => {
        // A typo here silently gates a working tool, or worse, un-gates nothing
        // while looking like it did.
        const toolBox = require('../../backend/infrastructure/ToolBox');
        for (const tool of READ_ONLY_TOOLS) {
            expect(typeof toolBox[tool]).toBe('function');
        }
    });
});
