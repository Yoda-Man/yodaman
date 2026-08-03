const fs = require('fs');
const path = require('path');
const { stripCliNoise } = require('../../backend/infrastructure/CliOutput');

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
