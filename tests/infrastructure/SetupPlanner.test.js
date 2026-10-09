/**
 * `yodaman setup` decides what to run in a shell on the user's machine, so the
 * interesting tests are about what it REFUSES to run.
 *
 * The hazard is concrete, not hypothetical. `DependencyChecker.SERVICES` was
 * written to print advice to a human, and two of its Ollama hints read:
 *
 *     "brew install ollama  or  download from https://ollama.com/download"
 *
 * That is a sentence. Handing it to a shell runs `brew install ollama or
 * download from …`. An installer that trusted these strings would have shipped
 * that, and the failure would have looked like a broken Homebrew rather than a
 * broken installer.
 *
 * So: the classifier is tested against the real SERVICES table rather than
 * fixtures, because the thing being guarded is the actual data.
 */
const { buildSetupPlan, formatSetupPlan, commandFor, isRunnableCommand, AUTOMATABLE } =
    require('../../backend/infrastructure/SetupPlanner');
const { SERVICES } = require('../../backend/infrastructure/DependencyChecker');

/** Every dependency missing — the state a first-time user is actually in. */
const nothingInstalled = () => Object.fromEntries(
    Object.keys(SERVICES).map((name) => [name, { name, found: false }])
);

describe('what setup refuses to execute', () => {
    it('rejects prose that names two alternatives', () => {
        expect(isRunnableCommand('brew install ollama  or  download from https://ollama.com/download'))
            .toBe(false);
        expect(isRunnableCommand('winget install Ollama.Ollama  or  download from https://x'))
            .toBe(false);
    });

    it('rejects a bare URL, which is a destination and not an instruction', () => {
        expect(isRunnableCommand('https://ollama.com')).toBe(false);
    });

    it('refuses anything containing sudo', () => {
        // An installer that asks for a password trains people to type one
        // without reading what asked.
        expect(isRunnableCommand('sudo npm install -g something')).toBe(false);
        expect(isRunnableCommand('npm install -g x && sudo ln -s a b')).toBe(false);
    });

    it('rejects empty and non-string hints', () => {
        for (const value of ['', '   ', null, undefined, 42, {}]) {
            expect(isRunnableCommand(value)).toBe(false);
        }
    });

    it('accepts a single unambiguous command', () => {
        expect(isRunnableCommand('npm install -g @contextexpert/cli')).toBe(true);
        expect(isRunnableCommand('python3 -m pip install --user graphifyy')).toBe(true);
    });

    it('no command the planner would run mentions sudo, on any platform', () => {
        // The property that matters, asserted over the real table rather than
        // over examples chosen to pass.
        for (const platform of ['darwin', 'linux', 'win32']) {
            const plan = buildSetupPlan({ checks: nothingInstalled(), platform });
            for (const step of plan.automatic) {
                expect(step.command).not.toMatch(/\bsudo\b/);
            }
        }
    });
});

describe('the real SERVICES table', () => {
    it('classifies the prose Ollama hints as NOT runnable', () => {
        // The specific bug this file exists for. If someone rewrites those
        // hints into real commands this test should be updated deliberately,
        // not deleted.
        expect(commandFor('ollama', 'darwin')).toBeNull();
        expect(commandFor('ollama', 'win32')).toBeNull();
    });

    it('still finds runnable commands for the package installs', () => {
        // Guards against the classifier being so strict it rejects everything —
        // a plan with nothing in it would pass every test above while doing
        // nothing at all.
        for (const platform of ['darwin', 'linux', 'win32']) {
            expect(commandFor('ctx', platform)).toMatch(/npm install/);
            expect(commandFor('openspec', platform)).toMatch(/npm install/);
            expect(commandFor('graphify', platform)).toMatch(/pip install/);
        }
    });

    it('covers every dependency the checker knows about', () => {
        // Drift guard, mirroring the ignored-paths one. A dependency added to
        // SERVICES must be either automated or explicitly manual; it may not
        // silently vanish from setup.
        const plan = buildSetupPlan({ checks: nothingInstalled(), platform: 'darwin' });
        const covered = [...plan.satisfied, ...plan.automatic.map((s) => s.name), ...plan.manual.map((s) => s.name)];
        expect(covered.sort()).toEqual(Object.keys(SERVICES).sort());
    });
});

describe('building the plan', () => {
    it('installs nothing that is already present', () => {
        const checks = {
            ollama: { found: true }, ctx: { found: true },
            graphify: { found: true }, openspec: { found: true }
        };
        const plan = buildSetupPlan({ checks, platform: 'darwin' });

        expect(plan.ok).toBe(true);
        expect(plan.automatic).toHaveLength(0);
        expect(plan.manual).toHaveLength(0);
        expect(plan.satisfied.sort()).toEqual(Object.keys(SERVICES).sort());
    });

    it('automates the three package installs and leaves Ollama to the user', () => {
        const plan = buildSetupPlan({ checks: nothingInstalled(), platform: 'darwin' });

        expect(plan.automatic.map((s) => s.name).sort()).toEqual(['ctx', 'graphify', 'openspec']);
        expect(plan.manual.map((s) => s.name)).toEqual(['ollama']);
        expect(plan.ok).toBe(false);
    });

    it('treats a dependency the checker did not report on as missing', () => {
        // Not as satisfied. A checker that failed to run must not be read as
        // "everything is fine" — that is a green result from a check that
        // measured nothing.
        const plan = buildSetupPlan({ checks: {}, platform: 'darwin' });
        expect(plan.satisfied).toHaveLength(0);
        expect(plan.automatic.length + plan.manual.length).toBe(Object.keys(SERVICES).length);
    });

    it('explains why each manual step is manual', () => {
        const plan = buildSetupPlan({ checks: nothingInstalled(), platform: 'darwin' });
        const ollama = plan.manual.find((s) => s.name === 'ollama');
        expect(ollama.reason).toMatch(/system service/);
        // It still hands over the instruction rather than just refusing.
        expect(ollama.instruction).toMatch(/ollama/i);
    });

    it('defaults to the running platform', () => {
        const plan = buildSetupPlan({ checks: nothingInstalled() });
        expect(plan.automatic.length + plan.manual.length).toBe(Object.keys(SERVICES).length);
    });
});

describe('the printed plan', () => {
    const plan = buildSetupPlan({ checks: nothingInstalled(), platform: 'darwin' });
    const text = formatSetupPlan(plan);

    it('shows the exact command before it is run', () => {
        // --dry-run and the real run print the same text, so what a user
        // approves is what executes.
        expect(text).toContain('npm install -g @contextexpert/cli');
        expect(text).toContain('python3 -m pip install --user graphifyy');
    });

    it('does not present the Ollama prose as something it will run', () => {
        const willInstall = text.slice(text.indexOf('Will install:'), text.indexOf('You will need'));
        expect(willInstall).not.toMatch(/ollama/i);
        expect(text).toMatch(/install these yourself[\s\S]*ollama/i);
    });

    it('says so plainly when there is nothing to do', () => {
        const done = buildSetupPlan({
            checks: Object.fromEntries(Object.keys(SERVICES).map((n) => [n, { found: true }])),
            platform: 'darwin'
        });
        expect(formatSetupPlan(done)).toMatch(/Everything YodaMan needs is already installed/);
    });
});

describe('AUTOMATABLE is a deliberate list', () => {
    it('does not include ollama', () => {
        // Adding it here is the one-line change that would start silently
        // installing a background service. It should require deleting a test.
        expect(AUTOMATABLE.has('ollama')).toBe(false);
    });
});
