// find-unused plugin test
const path = require('path');
const rootDir = path.resolve(__dirname, '../..');
describe('Droid-Sweep',()=>{let p;beforeAll(()=>{p=require(path.join(rootDir, 'plugins/Droid-Sweep.js'));});
test('exports',()=>{expect(p.name).toBe('Droid-Sweep');expect(typeof p.execute).toBe('function');});
test('scans for unused',async()=>{const r=await p.execute({workspacePath:rootDir});expect(r).toHaveProperty('totalFiles');expect(r).toHaveProperty('unusedCount');});
test('file details',async()=>{const r=await p.execute({workspacePath:rootDir});if(r.unusedCount>0){expect(r.unusedFiles[0]).toHaveProperty('filePath');}});
});
