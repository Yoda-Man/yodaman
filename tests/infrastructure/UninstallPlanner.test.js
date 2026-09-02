/**
 * `yodaman uninstall` deletes files, so every test here is about restraint.
 *
 * The failure mode is not "it missed a directory" — that leaves clutter. It is
 * "it removed something it did not create", and the worst case is concrete:
 * `openspec/` sits inside a workspace and looks generated, but those are specs
 * the USER wrote, and they exist nowhere else. A tool that erases original work
 * during cleanup is unrecoverable in a way no amount of leftover state is.
 *
 * So the plan is an exact allowlist, never a glob, and the protections are
 * asserted rather than assumed.
 */
const os = require('os');
const path = require('path');
const {
    buildUninstallPlan,
    formatUninstallPlan,
    isDangerousRoot
} = require('../../backend/infrastructure/UninstallPlanner');
const {
    DOC_CHUNKS_DIR,
    GRAPH_OUT_DIR,
    USER_OWNED_DIRS
} = require('../../shared/generatedPaths');

const HOME = '/Users/someone';
const WS = '/Users/someone/code/project-a';

/** Pretend every path exists, so the plan is decided by the rules, not the disk. */
const everythingExists = () => true;

const planFor = (overrides = {}) => buildUninstallPlan({
    workspaces: [WS],
    homeDir: HOME,
    exists: everythingExists,
    platform: 'linux',
    ...overrides
});

const removedPaths = (plan) => plan.remove.map((r) => r.path);

describe('what it refuses to remove', () => {
    it('never proposes openspec/, which the user wrote', () => {
        const plan = planFor();
        expect(removedPaths(plan)).not.toContain(path.join(WS, 'openspec'));
    });

    it('reports openspec/ as deliberately kept, rather than silently ignoring it', () => {
        // Silence would look identical to having missed it. Saying "kept, and
        // here is why" is what tells a user the decision was made on purpose.
        const plan = planFor();
        const kept = plan.protected.map((p) => p.path);
        expect(kept).toContain(path.join(WS, 'openspec'));
        expect(plan.protected[0].why).toMatch(/your specs/i);
    });

    it('never proposes the workspace itself', () => {
        expect(removedPaths(planFor())).not.toContain(WS);
    });

    it('never proposes anything outside the generated allowlist', () => {
        // The load-bearing property: every proposed path is either the home
        // state directory or ends in a name from generatedPaths.js.
        const plan = planFor();
        for (const target of removedPaths(plan)) {
            const base = path.basename(target);
            const allowed = base === '.yodaman' || base === DOC_CHUNKS_DIR || base === GRAPH_OUT_DIR;
            expect(allowed).toBe(true);
        }
    });

    it('refuses a workspace of "/" instead of walking it', () => {
        const plan = buildUninstallPlan({
            workspaces: ['/'], homeDir: HOME, exists: everythingExists, platform: 'linux'
        });
        expect(plan.remove.filter((r) => r.path.startsWith('/.'))).toHaveLength(0);
        expect(plan.skipped.map((s) => s.path)).toContain('/');
    });

    it('refuses the home directory itself', () => {
        const plan = buildUninstallPlan({
            workspaces: [HOME], homeDir: HOME, exists: everythingExists, platform: 'linux'
        });
        expect(plan.skipped.map((s) => s.path)).toContain(HOME);
    });

    it('says WHY it skipped, so a corrupt config is visible rather than swallowed', () => {
        const plan = buildUninstallPlan({
            workspaces: ['/'], homeDir: HOME, exists: everythingExists, platform: 'linux'
        });
        expect(plan.skipped[0].why).toMatch(/too broad|refusing/i);
    });

    it.each([['/'], [HOME], ['/Users/someone/Documents']])(
        'isDangerousRoot(%s) is true', (p) => {
            expect(isDangerousRoot(p, HOME)).toBe(true);
        });

    it('a real workspace is not treated as dangerous', () => {
        // Guards against the safety check being so broad it rejects everything,
        // which would pass every test above while removing nothing.
        expect(isDangerousRoot(WS, HOME)).toBe(false);
    });

    it('still defaults to the real home when none is given', () => {
        expect(isDangerousRoot(os.homedir())).toBe(true);
    });
});

describe('what it does propose', () => {
    it('includes both generated directories for each workspace', () => {
        const removed = removedPaths(planFor());
        expect(removed).toContain(path.join(WS, DOC_CHUNKS_DIR));
        expect(removed).toContain(path.join(WS, GRAPH_OUT_DIR));
    });

    it('includes the home state directory', () => {
        expect(removedPaths(planFor())).toContain(path.join(HOME, '.yodaman'));
    });

    it('handles several workspaces', () => {
        const b = '/Users/someone/code/project-b';
        const removed = removedPaths(planFor({ workspaces: [WS, b] }));
        expect(removed).toContain(path.join(b, GRAPH_OUT_DIR));
        expect(removed).toContain(path.join(WS, GRAPH_OUT_DIR));
    });

    it('proposes only what exists', () => {
        // exists() says no to everything, so nothing should be proposed —
        // an uninstall must not report removing what was never there.
        const plan = planFor({ exists: () => false });
        expect(plan.remove).toHaveLength(0);
    });

    it.each([[''], ['   '], [null], [undefined], [42]])(
        'skips %p rather than building a path from it', (value) => {
            const plan = planFor({ workspaces: [value] });
            expect(plan.remove.some((r) => r.path.includes('undefined') || r.path.includes('null')))
                .toBe(false);
        }
    );
});

describe('things it tells the user to do rather than doing', () => {
    it('does not run npm uninstall itself', () => {
        const plan = planFor();
        expect(plan.manual.map((m) => m.action).join(' ')).toMatch(/npm uninstall -g yodaman/);
    });

    it('does not delete the Ollama plist backup — it is the only copy', () => {
        const plan = planFor({ platform: 'darwin' });
        const backup = path.join(HOME, 'Library', 'LaunchAgents', 'homebrew.mxcl.ollama.plist.yodaman-backup');
        expect(removedPaths(plan)).not.toContain(backup);
        expect(plan.manual.map((m) => m.action).join(' ')).toContain(backup);
    });

    it('mentions the plist only on macOS', () => {
        const plan = planFor({ platform: 'linux' });
        expect(plan.manual.map((m) => m.action).join(' ')).not.toMatch(/LaunchAgents/);
    });

    it('reminds the user to disconnect MCP clients', () => {
        expect(planFor().manual.map((m) => m.action).join(' ')).toMatch(/MCP client/i);
    });
});

describe('the printed plan', () => {
    const text = formatUninstallPlan(planFor({ platform: 'darwin' }));

    it('shows every path before anything is deleted', () => {
        expect(text).toContain(path.join(WS, GRAPH_OUT_DIR));
        expect(text).toContain(path.join(HOME, '.yodaman'));
    });

    it('states plainly that source code is untouched', () => {
        expect(text).toMatch(/source code is never touched/i);
    });

    it('shows what was kept and why', () => {
        expect(text).toMatch(/Kept —/);
        expect(text).toContain('openspec');
    });

    it('says so when there is nothing to remove', () => {
        const empty = formatUninstallPlan(planFor({ exists: () => false }));
        expect(empty).toMatch(/Nothing generated by YodaMan was found/);
    });
});

describe('generatedPaths has not drifted from the code that writes these', () => {
    const fs = require('fs');

    it('DOC_CHUNKS_DIR still matches docPreprocessor', () => {
        // Source-matched rather than duplicated: if someone renames the output
        // directory, uninstall would otherwise quietly stop finding it and
        // report a clean machine that is not clean.
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'utils', 'docPreprocessor.js'), 'utf8');
        expect(src).toContain(`'${DOC_CHUNKS_DIR}'`);
    });

    it('GRAPH_OUT_DIR still matches GraphifyService', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'infrastructure', 'GraphifyService.js'), 'utf8');
        expect(src).toContain(`'${GRAPH_OUT_DIR}'`);
    });

    it('openspec is still on the protected list', () => {
        // Removing it from that list is the one-line change that would start
        // deleting users' specs. It should require deleting this test.
        expect(USER_OWNED_DIRS).toContain('openspec');
    });
});
