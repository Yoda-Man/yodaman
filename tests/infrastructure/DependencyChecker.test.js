const fs = require('fs');
const path = require('path');
const dependencyChecker = require('../../backend/infrastructure/DependencyChecker');

describe('DependencyChecker service registry', () => {
    test('registers every runtime dependency the health checks report on', () => {
        expect(Object.keys(dependencyChecker.SERVICES).sort())
            .toEqual(['ctx', 'graphify', 'ollama', 'openspec']);
    });

    test('ctx installs YodaMan\'s fork, with its native build steps allowed', () => {
        // The original @contextexpert/cli crashes on start after a fresh
        // install (OpenTelemetry api 1.10, 2026-10-20) and is unmaintained.
        // (Before that, @context-expert/cli was a 404 every hint pointed at.)
        const ctx = dependencyChecker.SERVICES.ctx;

        expect(ctx.installUrl).toMatch(/^npm install -g yodaman-ctx --allow-scripts=\S*better-sqlite3\S*tree-sitter/);
        for (const platform of ['darwin', 'linux', 'win32']) expect(ctx.installHint[platform]).toBe(ctx.installUrl);
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

    // 30s, not Jest's 5s default. checkAll() shells out to `which` once per
    // service (5s timeout each) and probes Ollama over HTTP, so under a full
    // parallel run it routinely exceeds five seconds. It passed alone and
    // failed in `release:verify` — the worst kind of flake, because the signal
    // only appears in the run that gates a release.
    test('checkAll covers openspec', async () => {
        const results = await dependencyChecker.checkAll();
        expect(results).toHaveProperty('openspec');
        expect(results.openspec).toEqual(expect.objectContaining({
            name: 'openspec',
            found: expect.any(Boolean)
        }));
    }, 30000);

    // Same reasoning as above: locate() shells out to `which`, so it inherits
    // the same load sensitivity even though it only checks one name.
    test('locate reports an actionable install hint for an unknown tool', async () => {
        const result = await dependencyChecker.locate('not-a-real-tool');
        expect(result.found).toBe(false);
        expect(result.error).toContain('Unknown dependency');
    }, 30000);
});

describe('Health self-heal coverage', () => {
    const restControllerSource = fs.readFileSync(
        path.resolve(__dirname, '../../backend/interfaces/RestController.js'),
        'utf8'
    );

    test('install commands live in one place: Repair holds none of its own', () => {
        // POST /api/health/install kept its own installer table, a second copy
        // of what DependencyChecker.SERVICES says; Repair replaced it and reads
        // the commands through SetupPlanner.
        expect(restControllerSource).not.toMatch(/'install',\s*'-g'|npm install -g/);
        expect(restControllerSource).toContain('setupPlanner.runSetupPlan(');
    });

    test('Repair runs its commands without a shell', () => {
        const code = restControllerSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code).toContain('execFileAsync(bin, args');
        expect(code).not.toMatch(/\bexec\(|promisify\(exec\)/);
    });

    test('no self-heal installer pipes a remote script into a shell', () => {
        // POST /api/health/install used to run
        //   execFile('/bin/sh', ['-c', 'curl -fsSL <url>/install.sh | sh'])
        // from an unauthenticated endpoint. Every installer is argv-only now.
        //
        // Comments are stripped first: the hardened code documents what it
        // replaced, and that prose would otherwise match the pattern it warns about.
        const code = restControllerSource
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        expect(code).not.toMatch(/curl[^\n]*\|\s*sh/);
        expect(code).not.toContain("'/bin/sh'");
    });

    test('the desktop startup screen installs through Repair, not the removed route', () => {
        // Its Install buttons posted to /api/health/install for months after
        // that route was removed, so every click was a 404.
        const main = fs.readFileSync(path.resolve(__dirname, '../../electron/main.js'), 'utf8');
        expect(main).not.toContain('/api/health/install');
        expect(main).toContain("postJson('/api/setup/repair')");
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
            'public/manual.html'
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

describe('model awareness', () => {
    test('isWeakModel detects small models', () => {
        expect(dependencyChecker.isWeakModel(null)).toBeNull();
        expect(dependencyChecker.isWeakModel('')).toBeNull();
        expect(dependencyChecker.isWeakModel('qwen3.5:9b')).toBe(true);   // 9B < 14
        expect(dependencyChecker.isWeakModel('llama3.2:3b')).toBe(true);  // 3B < 14
        expect(dependencyChecker.isWeakModel('codellama:7b')).toBe(true); // 7B < 14
    });

    test('isWeakModel passes models ≥14B', () => {
        expect(dependencyChecker.isWeakModel('qwen2.5:14b')).toBe(false);
        expect(dependencyChecker.isWeakModel('codestral:22b')).toBe(false);
        expect(dependencyChecker.isWeakModel('deepseek-coder-v2')).toBeNull(); // no param count in name
        expect(dependencyChecker.isWeakModel('mixtral:8x7b')).toBe(true); // regex matches 7B; MoE total is ~47B
        expect(dependencyChecker.isWeakModel('gemma2:27b')).toBe(false);
    });

    test('isWeakModel handles edge cases', () => {
        expect(dependencyChecker.isWeakModel('model-with-no-b')).toBeNull();
        expect(dependencyChecker.isWeakModel('13B')).toBe(true);        // 13B < 14, uppercase
        expect(dependencyChecker.isWeakModel('my-model-14b-v2')).toBe(false);
    });
});

describe('Context Expert minimum version', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    test('isOlder compares numeric parts, not strings', () => {
        expect(dependencyChecker.isOlder('1.1.0', '1.3.3')).toBe(true);
        expect(dependencyChecker.isOlder('1.3.2', '1.3.3')).toBe(true);
        expect(dependencyChecker.isOlder('1.3.3', '1.3.3')).toBe(false);
        expect(dependencyChecker.isOlder('1.3.2', dependencyChecker.SERVICES.ctx.minVersion)).toBe(true);
        expect(dependencyChecker.isOlder('1.10.0', '1.3.3')).toBe(false);
        expect(dependencyChecker.isOlder('2.0', '1.3.3')).toBe(false);
        expect(dependencyChecker.isOlder('installed', '1.3.3')).toBe(false);
        expect(dependencyChecker.isOlder(null, '1.3.3')).toBe(false);
    });

    // A real fake `ctx` on PATH, so the gate is proven through locate() itself.
    (process.platform === 'win32' ? test.skip : test).each([
        ['1.1.0', false],
        [dependencyChecker.SERVICES.ctx.minVersion, true],
    ])('ctx %s is found=%s', async (version, found) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-ctx-'));
        fs.writeFileSync(path.join(dir, 'ctx'), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
        const oldPath = process.env.PATH;
        process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
        try {
            const result = await dependencyChecker.locate('ctx');
            expect(result.path).toBe(path.join(dir, 'ctx'));
            expect(result.version).toBe(version);
            expect(result.found).toBe(found);
            if (!found) expect(result.error).toContain(`needs ${dependencyChecker.SERVICES.ctx.minVersion} or newer`);
        } finally {
            process.env.PATH = oldPath;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('a graphify that is installed but cannot start', () => {
    // Homebrew replaced Python 3.14 with 3.15 and removed 3.14. The pip launcher
    // ~/Library/Python/3.14/bin/graphify stayed, its #! naming the removed
    // interpreter, so every spawn failed with ENOENT, while health said
    // "installed" because graphify was the one tool locate() never ran.
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const unix = process.platform === 'win32' ? test.skip : test;

    function fakeGraphify(body) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-graphify-'));
        fs.writeFileSync(path.join(dir, 'graphify'), body, { mode: 0o755 });
        return dir;
    }
    async function withPath(dirs, fn) {
        const old = process.env.PATH;
        process.env.PATH = [...dirs, old].join(path.delimiter);
        try { return await fn(); } finally { process.env.PATH = old; dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })); }
    }

    unix('a launcher whose interpreter is gone is not runnable, and which() passes over it', async () => {
        const dead = fakeGraphify('#!/nonexistent/python3.14\nprint("hi")\n');
        const alive = fakeGraphify('#!/bin/sh\nexit 0\n');
        expect(dependencyChecker.isRunnable(path.join(dead, 'graphify'))).toBe(false);
        expect(dependencyChecker.isRunnable(path.join(alive, 'graphify'))).toBe(true);
        await withPath([dead, alive], () => expect(dependencyChecker.which('graphify')).toBe(path.join(alive, 'graphify')));
    });

    unix('health runs graphify instead of trusting that the file exists', async () => {
        const failing = fakeGraphify('#!/bin/sh\necho "ModuleNotFoundError: No module named graphify" >&2\nexit 1\n');
        await withPath([failing], async () => {
            const result = await dependencyChecker.locate('graphify');
            expect(result.found).toBe(false);
            expect(result.error).toContain('fails to run');
        });
    });

    unix('a graphify that starts is reported installed', async () => {
        const working = fakeGraphify('#!/bin/sh\necho "usage: graphify"\n');
        await withPath([working], async () => {
            const result = await dependencyChecker.locate('graphify');
            expect(result).toEqual(expect.objectContaining({ found: true, version: 'installed', path: path.join(working, 'graphify') }));
        });
    });

    test('Repair can install graphify on Homebrew Python, which refuses plain --user installs', () => {
        expect(dependencyChecker.SERVICES.graphify.installHint.darwin).toContain('--break-system-packages');
    });
});
