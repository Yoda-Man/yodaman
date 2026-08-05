const fs = require('fs');
const path = require('path');
const { stripCliNoise, hasSubstantiveAnswer, summarizeCliError } = require('../../backend/infrastructure/CliOutput');

// Real observed output: the banner and progress line were previously rendered
// to the user as part of the assistant's answer.
const RAW_ASK_OUTPUT = [
    "◇ injected env (0) from .env // tip: ⌘ custom filepath { path: '/custom/path/.env' }",
    '',
    'Searching DidiPlex...',
    '',
    'Sources:',
    '[1] docs/CUSTOMISE.md (1.00)',
    '[2] graphify-out/GRAPH_REPORT.md (0.88)',
    '',
    'The top-level folders are `docs/`, `src/`, and **assets**.'
].join('\n');

describe('ctx ask output cleaning', () => {
    test('removes the CLI banner and progress chatter', () => {
        const cleaned = stripCliNoise(RAW_ASK_OUTPUT);

        expect(cleaned).not.toContain('injected env');
        expect(cleaned).not.toContain('custom filepath');
        expect(cleaned).not.toContain('Searching DidiPlex...');
    });

    test('keeps the answer and its source citations intact', () => {
        const cleaned = stripCliNoise(RAW_ASK_OUTPUT);

        expect(cleaned).toContain('Sources:');
        expect(cleaned).toContain('[1] docs/CUSTOMISE.md (1.00)');
        expect(cleaned).toContain('The top-level folders are `docs/`, `src/`, and **assets**.');
    });

    test('starts at the answer rather than the blank line the banner left behind', () => {
        expect(stripCliNoise(RAW_ASK_OUTPUT).startsWith('Sources:')).toBe(true);
    });

    test('leaves ordinary answers untouched', () => {
        const answer = 'Line one\n\nLine two with `code`.';
        expect(stripCliNoise(answer)).toBe(answer);
    });

    test('falls back to the raw text when everything looked like chrome', () => {
        // Never swallow the whole response just because it matched a noise rule.
        expect(stripCliNoise('Searching things...')).toBe('Searching things...');
    });

    test('handles empty and nullish output without throwing', () => {
        expect(stripCliNoise('')).toBe('');
        expect(stripCliNoise(null)).toBe('');
        expect(stripCliNoise(undefined)).toBe('');
    });
});

describe('hasSubstantiveAnswer', () => {
    // `ctx ask` prints its citation block whether or not generation produced
    // anything, so "non-empty string" is not the same as "answered".
    const CITATIONS_ONLY = 'Sources:\n[1] client/game_client.py (1.00)\n[2] README.md (0.88)';

    test('a bare citation list is not an answer', () => {
        expect(hasSubstantiveAnswer(CITATIONS_ONLY)).toBe(false);
    });

    test('citation lines without the header are still not an answer', () => {
        expect(hasSubstantiveAnswer('[1] README.md (1.00)\n[2] docs/api.md (0.5)')).toBe(false);
    });

    test('prose followed by citations is an answer', () => {
        expect(hasSubstantiveAnswer(`It has two dependents and no tests.\n\n${CITATIONS_ONLY}`)).toBe(true);
    });

    test('a tool call is an answer', () => {
        expect(hasSubstantiveAnswer('<tool_call>\n{"name":"impactOf"}\n</tool_call>')).toBe(true);
    });

    test('empty and nullish output is not an answer', () => {
        expect(hasSubstantiveAnswer('')).toBe(false);
        expect(hasSubstantiveAnswer(null)).toBe(false);
        expect(hasSubstantiveAnswer('   \n  ')).toBe(false);
    });
});

describe('summarizeCliError', () => {
    // ctx writes Node deprecation warnings before any real diagnostic, so naive
    // first-line reporting told users that punycode is deprecated.
    const REAL_FAILURE = [
        '(node:1152) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.',
        '(Use `node --trace-deprecation ...` to show where the warning was created)',
        'Error: Failed to connect to Ollama server: Cannot read properties of undefined (reading \'content\')',
        'Hint: Run with --verbose for more details',
    ].join('\n');

    test('reports the error, not the deprecation warning that precedes it', () => {
        const summary = summarizeCliError(REAL_FAILURE);
        expect(summary).toContain('Failed to connect to Ollama server');
        expect(summary).not.toContain('DeprecationWarning');
    });

    test('falls back to the first meaningful line when nothing says "error"', () => {
        expect(summarizeCliError('(node:1) [DEP0040] DeprecationWarning: x\nctx: no such project')).toBe('ctx: no such project');
    });

    test('never returns an empty string', () => {
        expect(summarizeCliError('')).toBeTruthy();
        expect(summarizeCliError(null)).toBeTruthy();
        expect(summarizeCliError('(node:1) [DEP0040] DeprecationWarning: only noise')).toBeTruthy();
    });
});

describe('answer paths use the cleaned output', () => {
    const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');

    test('chat ask endpoint strips CLI noise', () => {
        expect(read('backend/interfaces/RestController.js'))
            .toContain('answer = contextEngine.stripCliNoise(output)');
    });

    test('agent reasoning loop strips CLI noise', () => {
        expect(read('backend/core/AgentReasoningEngine.js'))
            .toContain('const output = stripCliNoise(raw.output)');
    });
});
