/**
 * No user text reaches the graphify command line where it could be read as a flag.
 *
 * Graphify reads its free-text arguments by position (so `--` would itself
 * become the text) but still treats some of them as flags: `affected -h`
 * prints help instead of answering, and `save-result` parses with argparse,
 * which refuses `--answer "- a bullet list"`. GraphifyService guards each one
 * (`argument()` refuses a leading "-", save-result binds values with `=`).
 *
 * This calls EVERY GraphifyService method with a flag-shaped sentinel in every
 * text parameter, so a new method that passes user text through unguarded
 * fails here without anyone remembering to add it to a list.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const mockArgv = [];
jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execFile: (file, args, options, callback) => {
        mockArgv.push(args);
        (typeof options === 'function' ? options : callback)(null, '', '');
    }
}));
jest.mock('../../backend/infrastructure/DependencyChecker', () => ({
    which: () => null,
    isRunnable: () => false,
    check: async () => ({ found: false, error: 'stub' })
}));
jest.mock('../../backend/infrastructure/Logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const SENTINEL = '-yodaman-flag';

/** The parameter list of a method, as written. */
function params(fn) {
    const source = fn.toString();
    const open = source.indexOf('(');
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if ('({['.includes(source[i])) depth++;
        if (')}]'.includes(source[i]) && --depth === 0) return source.slice(open + 1, i);
    }
    return '';
}

/** Arguments for a method: the workspace for `projectPath`, the sentinel for every text field. */
function argsFor(fn, workspace) {
    const list = [];
    let depth = 0;
    let current = '';
    for (const ch of params(fn)) {
        if ('({['.includes(ch)) depth++;
        if (')}]'.includes(ch)) depth--;
        if (ch === ',' && depth === 0) { list.push(current.trim()); current = ''; } else current += ch;
    }
    if (current.trim()) list.push(current.trim());
    return list.map((param) => {
        if (/^projectPath\b/.test(param)) return workspace;
        if (!param.startsWith('{')) return SENTINEL;
        const fields = {};
        for (const field of param.replace(/^\{|\}\s*(=\s*\{\s*\})?$/g, '').split(',')) {
            const [name, fallback = ''] = field.split('=').map((s) => s.trim());
            if (!name) continue;
            if (fallback.startsWith('[')) fields[name] = [SENTINEL];
            else if (!/^(\d|true|false)/.test(fallback)) fields[name] = SENTINEL;
        }
        return fields;
    });
}

describe('graphify argv from user text', () => {
    let workspace;
    beforeAll(() => {
        process.env.YODAMAN_GRAPHIFY_BIN = '/nonexistent/graphify';
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-argv-guard-'));
        fs.mkdirSync(path.join(workspace, 'graphify-out'));
        fs.writeFileSync(path.join(workspace, 'graphify-out', 'graph.json'), JSON.stringify({ nodes: [], links: [] }));
    });
    afterAll(() => {
        delete process.env.YODAMAN_GRAPHIFY_BIN;
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    test('no method passes a flag-shaped value through as its own argv element', async () => {
        const service = require('../../backend/infrastructure/GraphifyService');
        const methods = Object.entries(service).filter(([, value]) => typeof value === 'function');
        const reached = [];
        for (const [name, fn] of methods) {
            const before = mockArgv.length;
            try { await fn.apply(service, argsFor(fn, workspace)); } catch (_err) { /* refusing is the guard */ }
            if (mockArgv.length > before) reached.push(name);
        }

        // The scan measured something: a free-text command ran graphify.
        expect(reached).toEqual(expect.arrayContaining(['query', 'tree', 'addToGlobal']));
        const leaked = mockArgv.filter((argv) => argv.includes(SENTINEL));
        expect(leaked).toEqual([]);
    });

    test('save-result binds a question and answer that start with "-" to their flags', async () => {
        // An ask answer that opens with a bullet list: argparse read it as a flag.
        const service = require('../../backend/infrastructure/GraphifyService');
        const before = mockArgv.length;
        await service.saveResult(workspace, { question: SENTINEL, answer: `${SENTINEL}\n- two` });
        const argv = mockArgv[before];
        expect(argv[0]).toBe('save-result');
        expect(argv).toEqual(expect.arrayContaining([`--question=${SENTINEL}`, `--answer=${SENTINEL}\n- two`]));
        expect(argv.filter((arg) => arg.startsWith(SENTINEL))).toEqual([]);
    });
});
