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
});
