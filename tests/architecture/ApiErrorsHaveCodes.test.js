/**
 * Every JSON error the API answers carries a machine-readable `code`.
 *
 * Clients branch on `code`, never on the English message. The 0.6.7 review
 * found errors without one: the 401 pairing-token refusal, the upload service,
 * plain-text 400/404s from the plugin and search routes, and a 500 from
 * /api/ask. Each was a one-off, so this scans for the whole class: an error
 * status answered without a code, or as plain text, fails here.
 *
 * To cover another route file, add it to FILES once its errors carry codes.
 * server.js is not scanned: its one plain-text 404 is the web page, not the
 * API (unknown /api paths get RestController's JSON 404, tested in ApiContract).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILES = [
    'backend/interfaces/RestController.js',
    'backend/services/fileUploadService.js',
    'backend/services/searchRouter.js'
];

/** The text between the parenthesis at `open` and its match, skipping strings. */
function argsAt(text, open) {
    let depth = 0;
    let quote = null;
    for (let i = open; i < text.length; i += 1) {
        const ch = text[i];
        if (quote) {
            if (ch === '\\') i += 1;
            else if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
        else if (ch === '(' || ch === '{' || ch === '[') depth += 1;
        else if (ch === ')' || ch === '}' || ch === ']') {
            depth -= 1;
            if (depth === 0) return text.slice(open + 1, i);
        }
    }
    throw new Error(`unbalanced call at ${open}`);
}

/** Top-level arguments of a call, split on commas outside strings and brackets. */
function splitArgs(args) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < args.length; i += 1) {
        const ch = args[i];
        if (quote) {
            if (ch === '\\') i += 1;
            else if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
        else if ('({['.includes(ch)) depth += 1;
        else if (')}]'.includes(ch)) depth -= 1;
        else if (ch === ',' && depth === 0) {
            parts.push(args.slice(start, i).trim());
            start = i + 1;
        }
    }
    parts.push(args.slice(start).trim());
    return parts.filter(Boolean);
}

const line = (text, index) => text.slice(0, index).split('\n').length;

/** Every place in `text` that answers an error without a code. */
function errorsWithoutCode(text) {
    const found = [];
    for (const match of text.matchAll(/\.status\(/g)) {
        const statusArgs = argsAt(text, match.index + '.status'.length);
        const literal = /^\d{3}$/.test(statusArgs.trim()) ? Number(statusArgs) : null;
        if (literal !== null && literal < 400) continue;
        const after = text.slice(match.index + '.status'.length + statusArgs.length + 2);
        const reply = /^\s*\.(json|send)\(/.exec(after);
        if (!reply) continue;
        const body = argsAt(after, reply[0].length - 1);
        if (reply[1] === 'send' || !/\bcode\b/.test(body)) found.push(`line ${line(text, match.index)}: .status(${statusArgs}).${reply[1]}(${body.slice(0, 60)})`);
    }
    for (const match of text.matchAll(/\bjsonError\(/g)) {
        if (/function\s+$/.test(text.slice(0, match.index))) continue;
        const args = splitArgs(argsAt(text, match.index + 'jsonError'.length));
        if (args.length < 4) found.push(`line ${line(text, match.index)}: jsonError(${args.join(', ').slice(0, 60)})`);
    }
    return found;
}

describe('API errors carry a code', () => {
    test.each(FILES)('%s', (file) => {
        expect(errorsWithoutCode(fs.readFileSync(path.join(ROOT, file), 'utf8'))).toEqual([]);
    });

    test('the scan finds the defects it exists for', () => {
        // Proves the guard can fail: each shape that shipped in 0.6.6.
        expect(errorsWithoutCode("return res.status(401).json({ error: 'Valid token is required' });")).toHaveLength(1);
        expect(errorsWithoutCode("res.status(404).send('Plugin not found');")).toHaveLength(1);
        expect(errorsWithoutCode('res.status(err.status || 400).json({ error: err.message });')).toHaveLength(1);
        expect(errorsWithoutCode("jsonError(res, 400, `bad ${a, b}`);")).toHaveLength(1);
        expect(errorsWithoutCode("res.status(201).json({ ok: true }); jsonError(res, 400, 'x', 'bad');")).toEqual([]);
    });
});
