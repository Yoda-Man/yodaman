const ollamaConfig = require('../../backend/infrastructure/OllamaConfig');

/**
 * The context-window control writes a launchd plist and restarts a service.
 * That is more reach than the rest of this runtime has, so the guarantees that
 * keep it safe are worth asserting rather than trusting:
 *
 *   - only values from a fixed list are accepted, never free text
 *   - the plist edit produces valid, well-formed XML
 *   - an existing value is replaced rather than duplicated
 */
describe('OllamaConfig', () => {
    const PLIST = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<plist version="1.0">',
        '<dict>',
        '\t<key>Label</key>',
        '\t<string>homebrew.mxcl.ollama</string>',
        '</dict>',
        '</plist>'
    ].join('\n');

    describe('setContextLength input validation', () => {
        test.each([
            ['free text', 'lots'],
            ['a value not on the list', 999],
            ['zero', 0],
            ['negative', -1],
            ['absurdly large', 99999999],
            ['undefined', undefined]
        ])('rejects %s', async (_label, value) => {
            await expect(ollamaConfig.setContextLength(value)).rejects.toThrow(/must be one of/i);
        });

        test('rejects with a 400 so callers do not report it as a server fault', async () => {
            await expect(ollamaConfig.setContextLength(12345)).rejects.toMatchObject({ status: 400 });
        });

        test('the allowlist is what the API advertises', () => {
            expect(ollamaConfig.ALLOWED_VALUES).toEqual([8192, 16384, 32768, 65536, 131072]);
            expect(ollamaConfig.ALLOWED_VALUES).toContain(ollamaConfig.RECOMMENDED);
        });
    });

    describe('plist editing', () => {
        test('adds an EnvironmentVariables block when none exists', () => {
            const out = ollamaConfig.withContextLength(PLIST, 32768);
            expect(out).toContain('<key>EnvironmentVariables</key>');
            expect(out).toContain('<key>OLLAMA_CONTEXT_LENGTH</key>');
            expect(out).toContain('<string>32768</string>');
            // The original content must survive.
            expect(out).toContain('homebrew.mxcl.ollama');
        });

        test('replaces an existing value rather than adding a second one', () => {
            const once = ollamaConfig.withContextLength(PLIST, 16384);
            const twice = ollamaConfig.withContextLength(once, 65536);

            const occurrences = (twice.match(/OLLAMA_CONTEXT_LENGTH/g) || []).length;
            expect(occurrences).toBe(1);
            expect(twice).toContain('<string>65536</string>');
            expect(twice).not.toContain('<string>16384</string>');
        });

        test('produces balanced XML tags', () => {
            const out = ollamaConfig.withContextLength(PLIST, 32768);
            const open = (out.match(/<dict>/g) || []).length;
            const close = (out.match(/<\/dict>/g) || []).length;
            expect(open).toBe(close);
            expect(out.trim().endsWith('</plist>')).toBe(true);
        });

        test('reuses an EnvironmentVariables block that already exists', () => {
            const withEnv = PLIST.replace(
                '\t<key>Label</key>',
                '\t<key>EnvironmentVariables</key>\n\t<dict>\n\t\t<key>OTHER</key>\n\t\t<string>x</string>\n\t</dict>\n\t<key>Label</key>'
            );
            const out = ollamaConfig.withContextLength(withEnv, 32768);

            expect((out.match(/<key>EnvironmentVariables<\/key>/g) || []).length).toBe(1);
            // An unrelated variable must not be lost.
            expect(out).toContain('<key>OTHER</key>');
            expect(out).toContain('<string>32768</string>');
        });
    });

    describe('ollamaUrl', () => {
        const saved = process.env.OLLAMA_HOST;
        afterEach(() => {
            if (saved === undefined) delete process.env.OLLAMA_HOST; else process.env.OLLAMA_HOST = saved;
        });

        test.each([
            [undefined, 'http://127.0.0.1:11434'],
            ['', 'http://127.0.0.1:11434'],
            ['0.0.0.0', 'http://127.0.0.1:11434'],
            ['0.0.0.0:11500', 'http://127.0.0.1:11500'],
            [':11501', 'http://127.0.0.1:11501'],
            ['localhost', 'http://localhost:11434'],
            ['http://127.0.0.1:11502/', 'http://127.0.0.1:11502'],
            ['http://[::1', 'http://127.0.0.1:11434']
        ])('OLLAMA_HOST=%p gives %p', (host, expected) => {
            if (host === undefined) delete process.env.OLLAMA_HOST; else process.env.OLLAMA_HOST = host;
            expect(ollamaConfig.ollamaUrl()).toBe(expected);
        });
    });

    describe('inspect reads what a Homebrew Ollama reads', () => {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');

        test('the plist value wins over this runtime\'s own OLLAMA_CONTEXT_LENGTH', () => {
            // After POST /api/ollama/context the plist says 32768 while the
            // runtime's environment still says 4096 from when it started.
            const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-ollama-home-'));
            const saved = process.env.OLLAMA_CONTEXT_LENGTH;
            try {
                fs.mkdirSync(path.join(home, 'Library', 'LaunchAgents'), { recursive: true });
                fs.writeFileSync(path.join(home, 'Library', 'LaunchAgents', 'homebrew.mxcl.ollama.plist'),
                    ollamaConfig.withContextLength(PLIST, 32768));
                process.env.OLLAMA_CONTEXT_LENGTH = '4096';
                let state;
                jest.isolateModules(() => {
                    jest.doMock('os', () => ({ ...jest.requireActual('os'), homedir: () => home }));
                    state = require('../../backend/infrastructure/OllamaConfig').inspect();
                });
                expect(state).toMatchObject({ managed: true, configured: 32768 });
            } finally {
                jest.dontMock('os');
                if (saved === undefined) delete process.env.OLLAMA_CONTEXT_LENGTH; else process.env.OLLAMA_CONTEXT_LENGTH = saved;
                fs.rmSync(home, { recursive: true, force: true });
            }
        });
    });

    describe('inspect', () => {
        test('reports the allowlist and recommendation for the UI to render', () => {
            const state = ollamaConfig.inspect();
            expect(state).toHaveProperty('managed');
            expect(state).toHaveProperty('recommended', 32768);
            expect(Array.isArray(state.allowed)).toBe(true);
        });
    });
});
