/**
 * Open a workspace file in the user's editor, at the right line.
 *
 * WHY THIS EXISTS:
 *
 * File links in Chat were `vscode://file/...` URLs, handed to the OS by the
 * Electron window. That opens VS Code, whatever the user actually uses. On the
 * machine this was reported from, the default app for .js, .py, .ts, .md and
 * .json is Antigravity IDE, so "open this file" opened a different editor, or
 * nothing at all on a machine without VS Code. The Search view was worse: its
 * results had no open action, and the icon that looked like one only expanded
 * the snippet.
 *
 * The runtime is a local process on the same machine, so it can ask the OS for
 * the default application directly and launch that, which is what "my default
 * IDE" means.
 *
 * HOW THE EDITOR IS CHOSEN (Settings > Editor, stored as `editorCommand`):
 *
 *   - Empty or "system" (the default): the OS default application for that
 *     file's type. Nothing is assumed about which editor that is.
 *   - An app bundle ("/Applications/Zed.app"): that app.
 *   - Any other value is a command template, so ANY editor works, including
 *     ones YodaMan has never heard of:
 *         idea --line {line} {file}
 *         xed -l {line} {file}
 *         emacsclient -n +{line} {file}
 *         "/opt/My Editor/bin/edit" --goto {file}:{line}:{column}
 *     It is split into arguments like a shell would split it, but never run
 *     through one, so a file name can never become part of a command.
 *
 * For an app (default or chosen), if the bundle carries a command line we
 * recognise, it is used so the file opens AT THE LINE. Otherwise the file opens
 * in that app without a line, which is still the right editor; a template is
 * how any other editor gets line numbers too.
 *
 * Planning is pure (planLaunch) so tests can assert every decision without
 * launching anything. Only launch() touches the machine.
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

/**
 * Editors whose app bundles carry a command line that accepts a line number.
 * Matched by what the bundle contains, not by its name, so a renamed or
 * re-branded build (Antigravity, Cursor, Windsurf are all VS Code forks) is
 * still recognised.
 */
const BUNDLED_CLIS = [
    // VS Code and its forks: Contents/Resources/app/bin/<name>, `-g file:line`.
    {
        find: (app) => {
            const dir = path.join(app, 'Contents', 'Resources', 'app', 'bin');
            let entries;
            try { entries = fs.readdirSync(dir); } catch (_err) { return null; }
            // The CLI is the one extensionless executable; skip helper scripts.
            const cli = entries.find((name) => !name.includes('.') && !/tunnel/i.test(name));
            return cli ? path.join(dir, cli) : null;
        },
        args: (file, line) => (line ? ['-g', `${file}:${line}`] : [file])
    },
    // Zed: Contents/MacOS/cli, `file:line`.
    {
        find: (app) => existing(path.join(app, 'Contents', 'MacOS', 'cli')),
        args: (file, line) => [line ? `${file}:${line}` : file]
    },
    // Sublime Text: Contents/SharedSupport/bin/subl, `file:line`.
    {
        find: (app) => existing(path.join(app, 'Contents', 'SharedSupport', 'bin', 'subl')),
        args: (file, line) => [line ? `${file}:${line}` : file]
    }
];

function existing(candidate) {
    try { return fs.statSync(candidate).isFile() ? candidate : null; } catch (_err) { return null; }
}

function appName(appPath) {
    return path.basename(String(appPath || '')).replace(/\.app$/i, '') || 'your default editor';
}

/**
 * Decide what to run. Pure apart from looking inside an app bundle.
 *
 * @param {object} input
 * @param {string} input.file      Absolute path, already validated.
 * @param {number|null} input.line 1-based line, or null.
 * @param {string} input.platform  process.platform.
 * @param {string|null} input.app  macOS app bundle to use (configured or default).
 * @param {string|null} input.command A configured command on PATH, if any.
 * @returns {{command: string, args: string[], editor: string, line: boolean}}
 */
function planLaunch({ file, line = null, column = null, platform = process.platform, app = null, template = null }) {
    if (template) {
        const tokens = tokenize(template);
        if (!tokens.length) throw new Error('The editor command is empty');
        const usesFile = tokens.some((token) => token.includes('{file}'));
        const usesLine = tokens.some((token) => token.includes('{line}'));
        // Substituted per argument, after splitting: a path with spaces stays
        // one argument and cannot inject another.
        const fill = (token) => token
            .replace(/\{file\}/g, file)
            .replace(/\{line\}/g, String(line || 1))
            .replace(/\{column\}/g, String(column || 1));
        const [command, ...rest] = tokens.map(fill);
        return {
            command,
            args: usesFile ? rest : [...rest, file],
            editor: path.basename(command).replace(/\.(exe|cmd|bat)$/i, ''),
            line: Boolean(line && usesLine)
        };
    }

    if (platform === 'darwin') {
        if (app) {
            for (const known of BUNDLED_CLIS) {
                const cli = known.find(app);
                if (cli) return { command: cli, args: known.args(file, line), editor: appName(app), line: Boolean(line) };
            }
            return { command: 'open', args: ['-a', app, file], editor: appName(app), line: false };
        }
        return { command: 'open', args: [file], editor: 'your default editor', line: false };
    }

    if (platform === 'win32') {
        // explorer hands the file to its registered application. No shell, so
        // nothing in the path is ever interpreted.
        return { command: 'explorer.exe', args: [file], editor: 'your default editor', line: false };
    }

    return { command: 'xdg-open', args: [file], editor: 'your default editor', line: false };
}

/**
 * The macOS default application for a file, via Launch Services.
 * Resolves null when it cannot be determined; `open` then decides instead.
 */
function defaultAppFor(file) {
    if (process.platform !== 'darwin') return Promise.resolve(null);
    // The path travels as an argument, never inside the script source.
    const script = [
        'ObjC.import("AppKit");',
        'function run(argv) {',
        '  const url = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(argv[0]));',
        '  return url.isNil() ? "" : ObjC.unwrap(url.path);',
        '}'
    ].join('\n');
    return new Promise((resolve) => {
        execFile('osascript', ['-l', 'JavaScript', '-e', script, file], { timeout: 5000 }, (err, stdout) => {
            const app = String(stdout || '').trim();
            resolve(!err && app.endsWith('.app') ? app : null);
        });
    });
}

/**
 * Split a command template into arguments the way a shell would: whitespace
 * separates, single and double quotes group, backslash escapes inside double
 * quotes. Only splitting; nothing is expanded or executed.
 */
function tokenize(template) {
    const tokens = [];
    let current = '';
    let quote = null;
    let started = false;
    const text = String(template || '');
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quote) {
            if (ch === quote) { quote = null; continue; }
            if (ch === '\\' && quote === '"' && i + 1 < text.length) { current += text[++i]; continue; }
            current += ch;
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
        if (/\s/.test(ch)) {
            if (started) { tokens.push(current); current = ''; started = false; }
            continue;
        }
        current += ch;
        started = true;
    }
    if (quote) throw new Error('The editor command has an unclosed quote');
    if (started) tokens.push(current);
    return tokens;
}

/** Turn the `editorCommand` setting into a mode: system, app, or template. */
function interpretSetting(setting) {
    const value = typeof setting === 'string' ? setting.trim() : '';
    if (!value || value === 'system') return { app: null, template: null };
    if (/\.app\/?$/i.test(value) && !/\s\{/.test(value)) return { app: value.replace(/\/$/, ''), template: null };
    return { app: null, template: value };
}

/**
 * Reject a setting that can never launch anything, before it is saved.
 * @returns {string|null} The problem, or null when the value is usable.
 */
function validateSetting(value) {
    if (value === undefined || value === null || value === '' || value === 'system') return null;
    if (typeof value !== 'string') return 'The editor must be text';
    if (value.length > 1000) return 'The editor command must be 1000 characters or fewer';
    if (/[\0\r\n]/.test(value)) return 'The editor command must be a single line';
    try {
        if (!tokenize(value).length) return 'The editor command is empty';
    } catch (err) {
        return err.message;
    }
    return null;
}

/**
 * Command templates for editors found on PATH, offered as suggestions. A
 * suggestion, never a requirement: the template box accepts anything.
 */
const PATH_EDITORS = [
    ['code', 'Visual Studio Code', 'code -g {file}:{line}'],
    ['codium', 'VSCodium', 'codium -g {file}:{line}'],
    ['cursor', 'Cursor', 'cursor -g {file}:{line}'],
    ['windsurf', 'Windsurf', 'windsurf -g {file}:{line}'],
    ['zed', 'Zed', 'zed {file}:{line}'],
    ['subl', 'Sublime Text', 'subl {file}:{line}'],
    ['idea', 'IntelliJ IDEA', 'idea --line {line} {file}'],
    ['pycharm', 'PyCharm', 'pycharm --line {line} {file}'],
    ['webstorm', 'WebStorm', 'webstorm --line {line} {file}'],
    ['xed', 'Xcode', 'xed -l {line} {file}'],
    ['kate', 'Kate', 'kate -l {line} {file}'],
    ['gedit', 'gedit', 'gedit +{line} {file}'],
    ['emacsclient', 'Emacs', 'emacsclient -n +{line} {file}']
];

function onPath(name) {
    const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    return dirs.some((dir) => exts.some((ext) => existing(path.join(dir, name + ext))));
}

/**
 * Editors this machine has, for the Settings picker. Apps whose bundled CLI we
 * recognise are listed with line support; every other app is still reachable
 * through "System default" or a custom command.
 */
function detectEditors() {
    const found = [];
    const seen = new Set();
    if (process.platform === 'darwin') {
        const roots = ['/Applications', path.join(require('os').homedir(), 'Applications')];
        for (const root of roots) {
            let entries;
            try { entries = fs.readdirSync(root); } catch (_err) { continue; }
            for (const entry of entries.filter((name) => name.endsWith('.app')).sort()) {
                const app = path.join(root, entry);
                if (BUNDLED_CLIS.some((known) => known.find(app)) && !seen.has(entry)) {
                    seen.add(entry);
                    found.push({ name: appName(app), setting: app, atLine: true });
                }
            }
        }
    }
    for (const [command, name, template] of PATH_EDITORS) {
        if (!seen.has(name) && onPath(command)) {
            seen.add(name);
            found.push({ name, setting: template, atLine: true });
        }
    }
    return found;
}

/**
 * Open the file. Resolves once the editor process has started.
 * @returns {Promise<{editor: string, line: boolean}>}
 */
async function launch({ file, line = null, setting = null }) {
    const configured = interpretSetting(setting);
    const app = configured.app || (configured.template ? null : await defaultAppFor(file));
    const plan = planLaunch({ file, line, app, template: configured.template });

    await new Promise((resolve, reject) => {
        const child = spawn(plan.command, plan.args, { detached: true, stdio: 'ignore' });
        child.once('error', (err) => reject(new Error(`Could not start ${plan.editor}: ${err.message}`)));
        child.once('spawn', () => {
            // The editor outlives the request and the runtime; never wait on it.
            child.unref();
            resolve();
        });
    });

    return { editor: plan.editor, line: plan.line };
}

module.exports = { planLaunch, interpretSetting, validateSetting, tokenize, detectEditors, defaultAppFor, launch };
