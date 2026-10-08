/**
 * Opening a search result or a chat file link must open the user's own editor.
 *
 * WHAT THE USER SAW:
 *
 * Results from a search "would not open the relevant code in the default IDE".
 * Two defects together:
 *
 *   - Chat file links were hardcoded `vscode://file/...` URLs. On the machine
 *     this was reported from, the default app for source files is Antigravity
 *     IDE, so links opened a different editor, or nothing without VS Code.
 *   - Search results had no open action at all. The icon that looked like
 *     "open externally" only expanded the snippet.
 *
 * Both now go through POST /api/editor/open, which asks the OS for the default
 * editor. This file tests the route's guards and the launch plan. Nothing here
 * actually starts an editor: EditorLauncher.launch is mocked, and planLaunch is
 * pure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../backend/infrastructure/EditorLauncher', () => {
    const actual = jest.requireActual('../../backend/infrastructure/EditorLauncher');
    return { ...actual, launch: jest.fn(async () => ({ editor: 'Antigravity IDE', line: true })) };
});

const editorLauncher = require('../../backend/infrastructure/EditorLauncher');
const router = require('../../backend/interfaces/routes/editorRoutes');

function handler() {
    const layer = router.stack.find((l) => l.route?.path === '/editor/open' && l.route.methods.post);
    return layer.route.stack[0].handle;
}

async function post(body, { ip = '127.0.0.1' } = {}) {
    const req = { body, ip, id: 'test', get: () => undefined };
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; }
    };
    await handler()(req, res);
    return res;
}

let workspace;
let outside;
let previousConfig;

beforeEach(() => {
    workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-editor-ws-')));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-editor-out-')));
    fs.mkdirSync(path.join(workspace, 'auth'));
    fs.writeFileSync(path.join(workspace, 'auth', 'login.py'), 'def login(): ...\n');
    fs.writeFileSync(path.join(workspace, 'main.py'), 'main()\n');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'not yours\n');

    previousConfig = process.env.YODAMAN_CONFIG_PATH;
    process.env.YODAMAN_CONFIG_PATH = path.join(workspace, 'config.json');
    fs.writeFileSync(process.env.YODAMAN_CONFIG_PATH, JSON.stringify({ watchedDirectories: [workspace] }));
    editorLauncher.launch.mockClear();
});

afterEach(() => {
    if (previousConfig === undefined) delete process.env.YODAMAN_CONFIG_PATH;
    else process.env.YODAMAN_CONFIG_PATH = previousConfig;
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
});

describe('POST /editor/open', () => {
    test('opens a workspace-relative search hit at its line', async () => {
        const res = await post({ workspace, path: 'auth/login.py', line: 12 });

        expect(res.statusCode).toBe(200);
        expect(res.payload).toEqual(expect.objectContaining({ opened: true, editor: 'Antigravity IDE' }));
        expect(editorLauncher.launch).toHaveBeenCalledWith(expect.objectContaining({
            file: path.join(workspace, 'auth', 'login.py'),
            line: 12
        }));
    });

    test('accepts the "./" prefix chat adds to root-level files', async () => {
        const res = await post({ workspace, path: './main.py', line: 21 });
        expect(res.statusCode).toBe(200);
        expect(editorLauncher.launch.mock.calls[0][0].file).toBe(path.join(workspace, 'main.py'));
    });

    test('refuses callers that are not on this computer', async () => {
        const res = await post({ workspace, path: 'main.py' }, { ip: '192.168.1.40' });
        expect(res.statusCode).toBe(403);
        expect(editorLauncher.launch).not.toHaveBeenCalled();
    });

    test('refuses a workspace that is not registered', async () => {
        const res = await post({ workspace: outside, path: 'secret.txt' });
        expect(res.statusCode).toBe(404);
        expect(editorLauncher.launch).not.toHaveBeenCalled();
    });

    test('refuses a path that climbs out of the workspace', async () => {
        const res = await post({ workspace, path: `../${path.basename(outside)}/secret.txt` });
        expect(res.statusCode).toBe(403);
        expect(editorLauncher.launch).not.toHaveBeenCalled();
    });

    test('refuses a symlink that points out of the workspace', async () => {
        fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(workspace, 'innocent.txt'));
        const res = await post({ workspace, path: 'innocent.txt' });
        expect(res.statusCode).toBe(403);
        expect(editorLauncher.launch).not.toHaveBeenCalled();
    });

    test('reports a missing file as 404 rather than launching anything', async () => {
        const res = await post({ workspace, path: 'nope.py' });
        expect(res.statusCode).toBe(404);
        expect(editorLauncher.launch).not.toHaveBeenCalled();
    });

    test('refuses directories and nonsense line numbers', async () => {
        expect((await post({ workspace, path: 'auth' })).statusCode).toBe(400);
        expect((await post({ workspace, path: 'main.py', line: -3 })).statusCode).toBe(400);
        expect((await post({ workspace, path: 'main.py', line: '12; rm -rf /' })).statusCode).toBe(400);
        expect(editorLauncher.launch).not.toHaveBeenCalled();
    });

    test('takes the editor from settings, never from the request', async () => {
        fs.writeFileSync(process.env.YODAMAN_CONFIG_PATH, JSON.stringify({
            watchedDirectories: [workspace], settings: { editorCommand: 'idea --line {line} {file}' }
        }));
        require('../../backend/infrastructure/SettingsProvider').reset();
        await post({ workspace, path: 'main.py', editor: '/bin/sh', editorCommand: '/bin/sh' });
        expect(editorLauncher.launch).toHaveBeenCalledWith(expect.objectContaining({ setting: 'idea --line {line} {file}' }));
    });
});

describe('which program opens the file', () => {
    const { planLaunch, interpretSetting } = jest.requireActual('../../backend/infrastructure/EditorLauncher');

    function fakeApp(layout) {
        const app = fs.mkdtempSync(path.join(os.tmpdir(), 'Fake Editor-')) + '.app';
        fs.mkdirSync(app, { recursive: true });
        for (const rel of layout) {
            fs.mkdirSync(path.dirname(path.join(app, rel)), { recursive: true });
            fs.writeFileSync(path.join(app, rel), '#!/bin/sh\n');
        }
        return app;
    }

    test('a VS Code fork (Antigravity, Cursor, Windsurf) opens at the line via its bundled CLI', () => {
        const app = fakeApp(['Contents/Resources/app/bin/antigravity-ide']);
        const plan = planLaunch({ file: '/w/a.py', line: 12, platform: 'darwin', app });
        expect(plan.command).toBe(path.join(app, 'Contents/Resources/app/bin/antigravity-ide'));
        expect(plan.args).toEqual(['-g', '/w/a.py:12']);
        expect(plan.line).toBe(true);
    });

    test('VS Code itself uses `code`, not the tunnel helper next to it', () => {
        const app = fakeApp(['Contents/Resources/app/bin/code', 'Contents/Resources/app/bin/code-tunnel']);
        expect(planLaunch({ file: '/w/a.py', line: 3, platform: 'darwin', app }).command).toMatch(/bin\/code$/);
    });

    test('Zed and Sublime get file:line', () => {
        const zed = fakeApp(['Contents/MacOS/cli']);
        const subl = fakeApp(['Contents/SharedSupport/bin/subl']);
        expect(planLaunch({ file: '/w/a.py', line: 7, platform: 'darwin', app: zed }).args).toEqual(['/w/a.py:7']);
        expect(planLaunch({ file: '/w/a.py', line: 7, platform: 'darwin', app: subl }).args).toEqual(['/w/a.py:7']);
    });

    test('an unknown app still opens the file, in that app, without a line', () => {
        const app = fakeApp(['Contents/Info.plist']);
        const plan = planLaunch({ file: '/w/a.py', line: 7, platform: 'darwin', app });
        expect(plan).toEqual(expect.objectContaining({ command: 'open', args: ['-a', app, '/w/a.py'], line: false }));
    });

    test('never builds a vscode:// URL: the default app decides', () => {
        const plan = planLaunch({ file: '/w/a.py', line: 7, platform: 'darwin', app: null });
        expect(plan).toEqual(expect.objectContaining({ command: 'open', args: ['/w/a.py'] }));
        expect(JSON.stringify(plan)).not.toMatch(/vscode:/);
    });

    test('Linux and Windows hand the file to the OS without a shell', () => {
        expect(planLaunch({ file: '/w/a.py', platform: 'linux' }).command).toBe('xdg-open');
        expect(planLaunch({ file: 'C:\\w\\a.py', platform: 'win32' }).command).toBe('explorer.exe');
    });

    test('the editor setting accepts an app bundle or a command, and "system" means default', () => {
        expect(interpretSetting('/Applications/Zed.app')).toEqual({ app: '/Applications/Zed.app', template: null });
        expect(interpretSetting('code -g {file}:{line}')).toEqual({ app: null, template: 'code -g {file}:{line}' });
        expect(interpretSetting('system')).toEqual({ app: null, template: null });
        expect(interpretSetting(undefined)).toEqual({ app: null, template: null });
    });
});

describe('any editor, through a command template', () => {
    const { planLaunch, tokenize, validateSetting } = jest.requireActual('../../backend/infrastructure/EditorLauncher');

    test.each([
        // Editors YodaMan has no built-in knowledge of, each with its own syntax.
        ['idea --line {line} {file}', ['idea', ['--line', '42', '/w/my file.py']]],
        ['xed -l {line} {file}', ['xed', ['-l', '42', '/w/my file.py']]],
        ['emacsclient -n +{line} {file}', ['emacsclient', ['-n', '+42', '/w/my file.py']]],
        ['"/opt/My Editor/bin/edit" --goto {file}:{line}:{column}', ['/opt/My Editor/bin/edit', ['--goto', '/w/my file.py:42:1']]],
        ['notepad++.exe -n{line} {file}', ['notepad++.exe', ['-n42', '/w/my file.py']]]
    ])('%s', (template, [command, args]) => {
        const plan = planLaunch({ file: '/w/my file.py', line: 42, template });
        expect(plan.command).toBe(command);
        expect(plan.args).toEqual(args);
        expect(plan.line).toBe(true);
    });

    test('a template without {file} gets the file appended', () => {
        expect(planLaunch({ file: '/w/a.py', line: 3, template: 'gvim --remote-tab' }).args).toEqual(['--remote-tab', '/w/a.py']);
    });

    test('a file name can never become extra arguments or a command', () => {
        // No shell is involved, and substitution happens after splitting, so the
        // whole hostile name stays one argument.
        const hostile = '/w/x; rm -rf ~ $(whoami) `id`.py';
        const plan = planLaunch({ file: hostile, line: 1, template: 'code -g {file}:{line}' });
        expect(plan.command).toBe('code');
        expect(plan.args).toEqual(['-g', `${hostile}:1`]);
    });

    test('quotes group and are removed, like a shell would', () => {
        expect(tokenize(`a "b c" 'd e' f\\g`)).toEqual(['a', 'b c', 'd e', 'f\\g']);
        expect(tokenize('"say \\"hi\\""')).toEqual(['say "hi"']);
    });

    test('settings that could never launch are refused before they are saved', () => {
        expect(validateSetting('')).toBeNull();
        expect(validateSetting('system')).toBeNull();
        expect(validateSetting('idea --line {line} {file}')).toBeNull();
        expect(validateSetting('"unterminated')).toMatch(/unclosed quote/);
        expect(validateSetting('code\nrm -rf /')).toMatch(/single line/);
        expect(validateSetting('   ')).toMatch(/empty/);
        expect(validateSetting(42)).toMatch(/text/);
    });
});
