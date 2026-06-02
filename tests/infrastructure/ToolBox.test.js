const toolBox = require('../../backend/infrastructure/ToolBox');
const contextEngine = require('../../backend/infrastructure/ContextEngine');
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

    test('searchCode falls back to filesystem search when ctx JSON search fails', async () => {
        const originalExecuteJson = contextEngine.executeJson;
        const searchFile = path.join(tempDir, 'menu-controller.js');
        fs.writeFileSync(searchFile, 'export function publishMenu() { return "menu"; }\n', 'utf8');
        contextEngine.executeJson = jest.fn(async () => {
            throw new Error('Failed to parse CLI JSON: No valid JSON block found in CLI output');
        });

        try {
            const results = await toolBox.searchCode({ query: 'menu', project: tempDir, top: 5 });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0]).toEqual(expect.objectContaining({
                content: expect.stringContaining('publishMenu'),
                score: expect.any(Number),
                metadata: expect.objectContaining({
                    path: searchFile
                })
            }));
        } finally {
            contextEngine.executeJson = originalExecuteJson;
        }
    });

    test('searchCode falls back when ctx returns a non-search JSON object', async () => {
        const originalExecuteJson = contextEngine.executeJson;
        const searchFile = path.join(tempDir, 'menu-service.js');
        fs.writeFileSync(searchFile, 'export const menuService = { publish: true };\n', 'utf8');
        contextEngine.executeJson = jest.fn(async () => ({
            error: 'No valid JSON block found in CLI output'
        }));

        try {
            const results = await toolBox.searchCode({ query: 'menuService', project: tempDir, top: 5 });

            expect(results).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    content: expect.stringContaining('menuService'),
                    metadata: expect.objectContaining({
                        source: 'filesystem-fallback'
                    })
                })
            ]));
        } finally {
            contextEngine.executeJson = originalExecuteJson;
        }
    });

    test('filesystem search fallback skips secret environment files', async () => {
        const secretFile = path.join(tempDir, '.env');
        const publicFile = path.join(tempDir, 'menu-docs.md');
        fs.writeFileSync(secretFile, 'SECRET_MENU_TOKEN=do-not-return\n', 'utf8');
        fs.writeFileSync(publicFile, 'menu docs are safe to return\n', 'utf8');

        const results = toolBox.searchCodeFilesystem({ query: 'menu', project: tempDir, top: 10 });
        const resultPaths = results.map(result => result.metadata.path);

        expect(resultPaths).toContain(publicFile);
        expect(resultPaths).not.toContain(secretFile);
    });
});
