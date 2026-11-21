// find-unused plugin test
const path = require('path');
const rootDir = path.resolve(__dirname, '../..');
describe('Droid-Sweep',()=>{let p;beforeAll(()=>{p=require(path.join(rootDir, 'plugins/Droid-Sweep.js'));});
test('exports',()=>{expect(p.name).toBe('Droid-Sweep');expect(typeof p.execute).toBe('function');});
test('scans for unused',async()=>{const r=await p.execute({workspacePath:rootDir});expect(r).toHaveProperty('totalFiles');expect(r).toHaveProperty('unusedCount');});
test('file details',async()=>{const r=await p.execute({workspacePath:rootDir});if(r.unusedCount>0){expect(r.unusedFiles[0]).toHaveProperty('filePath');}});
});

describe('Droid-Sweep text-scan fallback', () => {
    const fs = require('fs');
    const os = require('os');
    const plugin = require(path.join(rootDir, 'plugins/Droid-Sweep.js'));

    test('a file another file imports is not reported unused', async () => {
        // Each file used to search only ITSELF for its own name, so util.js,
        // imported by index.js, was reported unused.
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'droid-sweep-'));
        try {
            fs.writeFileSync(path.join(ws, 'index.js'), "const util = require('./util');\nimport { x } from './lib';\n");
            fs.writeFileSync(path.join(ws, 'util.js'), 'module.exports = 1;\n');
            fs.mkdirSync(path.join(ws, 'lib'));
            fs.writeFileSync(path.join(ws, 'lib', 'index.js'), 'export const x = 1;\n');
            fs.writeFileSync(path.join(ws, 'orphan.js'), 'module.exports = 2;\n');
            const result = await plugin.execute({ workspacePath: ws });
            expect(result.method).toBe('text-scan-fallback');
            expect(result.unusedFiles.map((f) => f.filePath)).toEqual(['orphan.js']);
        } finally {
            fs.rmSync(ws, { recursive: true, force: true });
        }
    });
});
