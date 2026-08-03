const fs = require('fs');
const path = require('path');
const dependencyChecker = require('../../backend/infrastructure/DependencyChecker');

describe('DependencyChecker service registry', () => {
    test('registers every runtime dependency the health checks report on', () => {
        expect(Object.keys(dependencyChecker.SERVICES).sort())
            .toEqual(['ctx', 'graphify', 'ollama', 'openspec']);
    });

    test('ctx installs the package that actually exists on npm', () => {
        // The registry has @contextexpert/cli; @context-expert/cli is a 404, so
        // every install hint and the self-heal command silently pointed at a
        // package that could never be installed.
        const ctx = dependencyChecker.SERVICES.ctx;

        expect(ctx.installUrl).toContain('@contextexpert/cli');
        expect(ctx.installUrl).not.toContain('@context-expert/cli');
        for (const platform of ['darwin', 'linux', 'win32']) {
            expect(ctx.installHint[platform]).toBe('npm install -g @contextexpert/cli');
        }
    });

    test('openspec is locatable and installable on every platform', () => {
        const openspec = dependencyChecker.SERVICES.openspec;

        expect(openspec.executable).toBe('openspec');
        expect(openspec.versionArgs).toEqual(['--version']);
        expect(openspec.installUrl).toContain('@fission-ai/openspec');
        for (const platform of ['darwin', 'linux', 'win32']) {
            expect(openspec.installHint[platform]).toContain('@fission-ai/openspec');
        }
    });

    test('checkAll covers openspec', async () => {
        const results = await dependencyChecker.checkAll();
        expect(results).toHaveProperty('openspec');
        expect(results.openspec).toEqual(expect.objectContaining({
            name: 'openspec',
            found: expect.any(Boolean)
        }));
    });

    test('locate reports an actionable install hint for an unknown tool', async () => {
        const result = await dependencyChecker.locate('not-a-real-tool');
        expect(result.found).toBe(false);
        expect(result.error).toContain('Unknown dependency');
    });
});

describe('Health self-heal coverage', () => {
    const restControllerSource = fs.readFileSync(
        path.resolve(__dirname, '../../backend/interfaces/RestController.js'),
        'utf8'
    );

    test('POST /health/install can repair openspec', () => {
        expect(restControllerSource).toContain("case 'openspec': {");
        expect(restControllerSource).toContain('npm install -g @fission-ai/openspec@latest');
    });

    test('GET /health reports openspec as a first-class check', () => {
        expect(restControllerSource).toContain('openspec: enrich(checks.openspec)');
    });

    test('no install path references the non-existent hyphenated ctx package', () => {
        const files = [
            'backend/infrastructure/DependencyChecker.js',
            'backend/interfaces/RestController.js',
            'setup.sh',
            'website/index.html',
            'README.md',
            'user_manual.md',
            'public/manual.html',
            'src/components/ManualWindow.jsx'
        ];

        for (const relativePath of files) {
            const source = fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
            expect(source).not.toContain('@context-expert/cli');
        }
    });
});

describe('setup.sh dependency checks', () => {
    const setupSource = fs.readFileSync(path.resolve(__dirname, '../../setup.sh'), 'utf8');

    test('verifies openspec alongside the other required tools', () => {
        expect(setupSource).toContain('Checking OpenSpec');
        expect(setupSource).toContain('check_cmd openspec');
        expect(setupSource).toContain('npm install -g @fission-ai/openspec@latest');
    });

    test('still verifies ollama, ctx, and graphify', () => {
        expect(setupSource).toContain('check_cmd ollama');
        expect(setupSource).toContain('check_cmd ctx');
        expect(setupSource).toContain('check_graphify');
    });
});
