/**
 * User text given to ctx goes after `--`.
 *
 * ctx parses its argv with commander, so a search for "-k 3" or "--help" was
 * read as flags: `ctx search -weird` answers "unknown option". After `--` it is
 * the query. `--json` is an option too, so it must come BEFORE the `--`:
 * after it, ctx answers "too many arguments" and every search fails.
 *
 * Graphify is deliberately not covered: `graphify query <q>` takes argv[2]
 * literally and has no `--`, which it would read as the question.
 *
 * Checked at the spawn boundary (ContextEngine.execute), so the argv tested is
 * the one ctx would really receive.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const contextEngine = require('../../backend/infrastructure/ContextEngine');
const toolBox = require('../../backend/infrastructure/ToolBox');

const QUERY = '-k 3 --help';

function expectQueryAfterDoubleDash(argv) {
    const end = argv.indexOf('--');
    expect(end).toBeGreaterThan(0);
    expect(argv.slice(end + 1)).toEqual([QUERY]);
    expect(argv.slice(0, end)).not.toContain(QUERY);
}

describe('ctx free-text arguments', () => {
    let execute;
    beforeEach(() => {
        execute = jest.spyOn(contextEngine, 'execute').mockResolvedValue({
            output: JSON.stringify([{ content: 'x', score: 1, metadata: { path: 'a.js' } }]),
            code: 0
        });
    });
    afterEach(() => execute.mockRestore());

    test('the agent search (ctx search) passes the query after --, with --json before it', async () => {
        await toolBox.contextExpertSearch({ query: QUERY, top: 5 });
        const [argv] = execute.mock.calls[0];
        expect(argv[0]).toBe('search');
        expectQueryAfterDoubleDash(argv);
        expect(argv.indexOf('--json')).toBeGreaterThan(-1);
        expect(argv.indexOf('--json')).toBeLessThan(argv.indexOf('--'));
    });

    test('ctx ask passes the prompt after --', async () => {
        await contextEngine.ask(QUERY);
        const [argv] = execute.mock.calls[0];
        expect(argv[0]).toBe('ask');
        expectQueryAfterDoubleDash(argv);
    });

    test('no other backend file builds a ctx search or ask argv the tests above do not cover', () => {
        const covered = new Set(['backend/infrastructure/ToolBox.js', 'backend/infrastructure/ContextEngine.js']);
        const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return walk(full);
            return entry.name.endsWith('.js') ? [full] : [];
        });
        const offenders = walk(path.join(ROOT, 'backend'))
            .filter((file) => /\[\s*['"](search|ask)['"]/.test(fs.readFileSync(file, 'utf8')))
            .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
            .filter((file) => !covered.has(file));
        expect(offenders).toEqual([]);
    });
});
