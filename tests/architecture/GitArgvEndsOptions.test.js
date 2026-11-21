/**
 * No value reaches git where git could read it as an option.
 *
 * `POST /api/git/commit` ran `git add ...files`, so a "file" named `-A` staged
 * every change in the workspace, and any request value starting with `-` was an
 * option to git. execFile stops shell injection; it does nothing about option
 * injection. So every argv passed to git in the runtime must be literals, except
 * after `--` / `--end-of-options`, or as the value of an option that takes one
 * (`-m <message>`, `-b <branch>`, `-n <count>`). A computed value anywhere else
 * fails this test: put it after `--`, or after `--end-of-options` for revisions.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCANNED = ['backend', 'bin', 'electron', 'plugins', 'shared'];
const VALUE_OPTIONS = new Set(['-m', '-b', '-n']);
const END_OF_OPTIONS = new Set(['--', '--end-of-options']);
// runGit(dir, [...]), simple-git's git.raw([...]), execFile('git', [...]), spawn('git', [...]).
const CALL = /(?:\brunGit\(\s*[\w.]+\s*,|\.raw\(|\b(?:execFile|execFileSync|spawn|spawnSync)\(\s*['"]git['"]\s*,)\s*/g;

function sources(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(full);
        return /\.(c?js|mjs)$/.test(entry.name) ? [full] : [];
    });
}

/** The text between the bracket at `open` and its match, or null. */
function bracketed(text, open) {
    let depth = 0;
    let quote = null;
    for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
        } else if (`'"\``.includes(ch)) quote = ch;
        else if ('[({'.includes(ch)) depth++;
        else if (')]}'.includes(ch) && --depth === 0) return text.slice(open + 1, i);
    }
    return null;
}

/** Top-level comma-separated elements of an array literal's body. */
function elements(body) {
    const out = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
        } else if (`'"\``.includes(ch)) quote = ch;
        else if ('[({'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
        else if (ch === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
    }
    out.push(body.slice(start));
    return out.map((e) => e.trim()).filter(Boolean);
}

/** Elements that git could read as an option. */
function unsafe(argv) {
    const bad = [];
    let ended = false;
    let previous = null;
    for (const element of argv) {
        const literal = /^(['"])(.*)\1$/s.exec(element)?.[2];
        if (ended) { /* everything after -- is a path or revision */ }
        else if (literal !== undefined) ended = END_OF_OPTIONS.has(literal);
        else if (/^`-/.test(element)) { /* --opt=${value}: the value cannot start an option */ }
        else if (!(previous !== null && VALUE_OPTIONS.has(previous))) bad.push(element);
        previous = literal ?? null;
    }
    return bad;
}

/** Every git argv in a file, with its line, as arrays of element source text. */
function gitCalls(text) {
    // Blank out comments, keeping newlines so line numbers stay true.
    const code = text.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, (c) => c.replace(/[^\n]/g, ' '));
    // runGit(dir, args) hands its parameter to execFile; its callers are what is checked.
    const wrapperParams = /function\s+runGit\(([^)]*)\)/.exec(code)?.[1].split(',').map((p) => p.trim().split(/\s|=/)[0]) || [];
    const calls = [];
    for (const match of code.matchAll(CALL)) {
        if (/function\s+$/.test(code.slice(0, match.index))) continue;
        const at = match.index + match[0].length;
        const line = code.slice(0, at).split('\n').length;
        let argv;
        if (code[at] === '[') {
            argv = elements(bracketed(code, at));
        } else {
            // A variable: its `const name = [...]` plus anything `name.push(...)`ed.
            const name = /^[\w$]+/.exec(code.slice(at))?.[0];
            if (wrapperParams.includes(name)) continue;
            const decl = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*\\[`).exec(code);
            if (!decl) { calls.push({ line, argv: [`<unresolved ${name}>`] }); continue; }
            argv = elements(bracketed(code, decl.index + decl[0].length - 1));
            for (const push of code.matchAll(new RegExp(`\\b${name}\\.push\\(`, 'g'))) {
                argv.push(...elements(bracketed(code, push.index + push[0].length - 1)));
            }
        }
        calls.push({ line, argv });
    }
    return calls;
}

describe('git argv in the runtime', () => {
    const calls = SCANNED.flatMap((dir) => sources(path.join(ROOT, dir))).flatMap((file) =>
        gitCalls(fs.readFileSync(file, 'utf8')).map((call) => ({ ...call, where: `${path.relative(ROOT, file)}:${call.line}` })));

    test('the scan finds the git calls (so the check below measures something)', () => {
        const files = new Set(calls.map((c) => c.where.split(':')[0]));
        expect([...files].sort()).toEqual(expect.arrayContaining([
            'backend/interfaces/routes/gitRoutes.js',
            'backend/interfaces/support/git.js',
            'backend/services/gitService.js'
        ]));
        expect(calls.length).toBeGreaterThan(15);
    });

    test('the rule flags the shapes that let a request value become an option', () => {
        expect(unsafe(elements("'add', ...files"))).toEqual(['...files']);
        expect(unsafe(elements("'show', '--numstat', hash"))).toEqual(['hash']);
        expect(unsafe(elements("'checkout', '-b', branch"))).toEqual([]);
        expect(unsafe(elements("'add', '--', ...files"))).toEqual([]);
        expect(unsafe(elements("'show', '--end-of-options', hash"))).toEqual([]);
        expect(unsafe(elements("'log', `--since=${days} days ago`"))).toEqual([]);
    });

    test.each(calls.map((c) => [c.where, c.argv]))('%s passes computed values only after -- or as an option value', (_where, argv) => {
        expect(unsafe(argv)).toEqual([]);
    });
});
