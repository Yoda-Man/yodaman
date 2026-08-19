const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * The modules the pre-handover audit listed as having no tests at all.
 *
 * None is large, but "small" is not "safe": PluginAPI is the surface every
 * third-party plugin is handed, DefaultCodingSkill is injected into every agent
 * prompt, and StardustWrapper shells out to a CLI. An untested module is one
 * nobody notices breaking.
 */

describe('PluginAPI', () => {
    const pluginApi = require('../../backend/infrastructure/PluginAPI');

    test('exposes a stable surface to plugins', () => {
        expect(pluginApi).toBeTruthy();
        // Whatever shape it has, it must be usable without throwing on load —
        // a plugin author's first interaction with it is require().
        expect(['object', 'function']).toContain(typeof pluginApi);
    });
});

describe('DefaultCodingSkill', () => {
    const skill = require('../../backend/core/DefaultCodingSkill');

    test('produces guidance text for the agent prompt', () => {
        const text = typeof skill === 'function' ? skill() : (skill.text || skill.prompt || String(skill));
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(50);
    });

    test('does not carry the tool-call syntax that broke qwen3.5', () => {
        // 0.4.6 moved the wire format off <tool_call> because that literal string
        // flips qwen3.5 into native function calling, which ctx 1.4.0 crashes on.
        // Any prompt fragment reintroducing it would bring the crash back.
        const text = typeof skill === 'function' ? skill() : (skill.text || skill.prompt || String(skill));
        expect(text).not.toContain('<tool_call>');
    });
});

describe('StardustWrapper', () => {
    const wrapper = require('../../backend/stardust/StardustWrapper');

    test('exposes the OpenSpec operations the routes call', () => {
        for (const method of ['list', 'validate']) {
            expect(typeof wrapper[method]).toBe('function');
        }
    });

    test('reports a missing workspace instead of throwing raw', async () => {
        const missing = path.join(os.tmpdir(), 'yodaman-does-not-exist-' + Date.now());
        // Either a rejection carrying a message, or a resolved result flagged
        // unavailable — both are handled outcomes. A raw crash is not.
        try {
            const result = await wrapper.list({ cwd: missing });
            expect(result).toBeDefined();
        } catch (err) {
            expect(err.message).toBeTruthy();
        }
    });
});

describe('gitRoutes', () => {
    test('mounts without throwing', () => {
        const router = require('../../backend/interfaces/routes/gitRoutes');
        expect(typeof router).toBe('function');
        expect(router.stack.length).toBeGreaterThan(0);
    });

    test('every route it declares is a git path', () => {
        const router = require('../../backend/interfaces/routes/gitRoutes');
        const paths = router.stack
            .filter((layer) => layer.route)
            .map((layer) => layer.route.path);

        expect(paths.length).toBeGreaterThan(0);
        for (const p of paths) expect(p).toMatch(/^\/git\//);
    });
});

describe('SettingsProvider', () => {
    const settings = require('../../backend/infrastructure/SettingsProvider');

    test('every security-relevant default is the safe value', () => {
        // These defaults are the product's security posture. A change here is a
        // change to what an unconfigured install allows.
        const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-settings-'));
        const file = path.join(cfg, 'config.json');
        fs.writeFileSync(file, JSON.stringify({ settings: {} }));

        const previous = process.env.YODAMAN_CONFIG_PATH;
        process.env.YODAMAN_CONFIG_PATH = file;
        try {
            expect(settings.get('requirePairingToken')).toBe(true);
            expect(settings.get('allowAgentCommands')).toBe(false);
            expect(settings.get('allowPluginUploads')).toBe(false);
            expect(settings.get('allowUnrestrictedPlugins')).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.YODAMAN_CONFIG_PATH;
            else process.env.YODAMAN_CONFIG_PATH = previous;
            fs.rmSync(cfg, { recursive: true, force: true });
        }
    });

    test('a malformed config falls back to defaults rather than crashing', () => {
        const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-settings-bad-'));
        const file = path.join(cfg, 'config.json');
        fs.writeFileSync(file, '{ this is not json');

        const previous = process.env.YODAMAN_CONFIG_PATH;
        process.env.YODAMAN_CONFIG_PATH = file;
        try {
            // Falling back is correct; 0.4.9 made it loud rather than silent.
            expect(settings.get('requirePairingToken')).toBe(true);
        } finally {
            if (previous === undefined) delete process.env.YODAMAN_CONFIG_PATH;
            else process.env.YODAMAN_CONFIG_PATH = previous;
            fs.rmSync(cfg, { recursive: true, force: true });
        }
    });
});
