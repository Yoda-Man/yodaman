const toolBox = require('../../backend/infrastructure/ToolBox');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('ToolBox', () => {
    let tempDir;

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-test-'));
    });

    afterAll(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('writeFile and readFile should work correctly', async () => {
        const testFile = path.join(tempDir, 'test.txt');
        const content = 'Hello YodaMan';

        await toolBox.writeFile({ filePath: testFile, content });
        expect(fs.existsSync(testFile)).toBe(true);

        const readResult = await toolBox.readFile({ filePath: testFile });
        expect(readResult.content).toBe(content);
    });

    test('listFiles should return entries', async () => {
        const results = await toolBox.listFiles({ directoryPath: tempDir });
        expect(Array.isArray(results)).toBe(true);
        expect(results.some(f => f.name === 'test.txt')).toBe(true);
    });

    test('readFile should throw error for missing file', async () => {
        const missingFile = path.join(tempDir, 'missing.txt');
        await expect(toolBox.readFile({ filePath: missingFile })).rejects.toThrow('File not found');
    });

    test('applyPatch should replace one exact match', async () => {
        const patchFile = path.join(tempDir, 'patch.txt');
        fs.writeFileSync(patchFile, 'alpha\nbeta\ngamma\n', 'utf8');

        const result = await toolBox.applyPatch({
            filePath: patchFile,
            oldText: 'beta',
            newText: 'delta'
        });

        expect(result.message).toContain('Successfully patched');
        expect(fs.readFileSync(patchFile, 'utf8')).toBe('alpha\ndelta\ngamma\n');
    });

    test('applyPatch should reject ambiguous matches', async () => {
        const patchFile = path.join(tempDir, 'ambiguous.txt');
        fs.writeFileSync(patchFile, 'same\nsame\n', 'utf8');

        await expect(toolBox.applyPatch({
            filePath: patchFile,
            oldText: 'same',
            newText: 'changed'
        })).rejects.toThrow('matched more than once');
    });

    test('sanitizeParameters should redact patch payloads in audit metadata', () => {
        expect(toolBox.sanitizeParameters({
            filePath: 'example.js',
            oldContent: 'old text',
            newContent: 'new text here',
            content: 'full file'
        })).toEqual({
            filePath: 'example.js',
            oldContent: '[8 chars]',
            newContent: '[13 chars]',
            content: '[9 chars]'
        });
    });

    test('resolveAllowedPath should reject paths outside allowed roots', () => {
        const outsidePath = path.join('/private', 'var', 'not-yodaman-test.txt');
        expect(() => toolBox.resolveAllowedPath(outsidePath)).toThrow('Path is outside allowed workspaces');
    });

    test('executeCommand should block dangerous command patterns', async () => {
        await expect(toolBox.executeCommand({
            command: 'sudo rm -rf /',
            cwd: tempDir
        })).rejects.toThrow(/Agent shell commands are disabled|Command blocked by policy/);
    });

    test('executeCommand should be disabled by default', async () => {
        const original = process.env.YODAMAN_ALLOW_AGENT_COMMANDS;
        delete process.env.YODAMAN_ALLOW_AGENT_COMMANDS;

        try {
            await expect(toolBox.executeCommand({
                command: 'echo hello',
                cwd: tempDir
            })).rejects.toThrow('Agent shell commands are disabled');
        } finally {
            if (original === undefined) {
                delete process.env.YODAMAN_ALLOW_AGENT_COMMANDS;
            } else {
                process.env.YODAMAN_ALLOW_AGENT_COMMANDS = original;
            }
        }
    });
});
