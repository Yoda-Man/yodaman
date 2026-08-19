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

    describe('inspect', () => {
        test('reports the allowlist and recommendation for the UI to render', () => {
            const state = ollamaConfig.inspect();
            expect(state).toHaveProperty('managed');
            expect(state).toHaveProperty('recommended', 32768);
            expect(Array.isArray(state.allowed)).toBe(true);
        });
    });
});
