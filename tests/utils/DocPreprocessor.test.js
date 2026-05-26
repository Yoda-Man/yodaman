const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    splitByHeadings,
    extractJSDocComments,
    preprocessDocumentation
} = require('../../backend/utils/docPreprocessor');

describe('docPreprocessor', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-docs-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('splits markdown files into heading-based chunks', () => {
        const filePath = path.join(tempDir, 'README.md');
        fs.writeFileSync(filePath, '# Setup\nInstall it\n## Run\nStart it\n', 'utf8');

        const chunks = splitByHeadings(filePath);

        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toMatchObject({
            heading: 'Setup',
            level: 1,
            type: 'doc-section'
        });
        expect(chunks[1].content).toContain('Start it');
    });

    test('extracts JSDoc comments from source files', () => {
        const filePath = path.join(tempDir, 'tool.js');
        fs.writeFileSync(filePath, '/**\n * Adds two values.\n */\nfunction add() {}\n', 'utf8');

        const comments = extractJSDocComments(filePath);

        expect(comments).toHaveLength(1);
        expect(comments[0]).toMatchObject({
            heading: 'Adds two values.',
            type: 'jsdoc'
        });
    });

    test('writes doc chunk files for documentation and JSDoc', async () => {
        fs.writeFileSync(path.join(tempDir, 'guide.md'), '# Guide\nUse it\n', 'utf8');
        fs.writeFileSync(path.join(tempDir, 'api.js'), '/** API docs */\nmodule.exports = {};\n', 'utf8');

        const chunks = await preprocessDocumentation(tempDir);
        const chunkDir = path.join(tempDir, '.yodaman-doc-chunks');

        expect(chunks.length).toBeGreaterThanOrEqual(2);
        expect(fs.readdirSync(chunkDir).some((name) => name.endsWith('.doc-chunk'))).toBe(true);
    });
});
