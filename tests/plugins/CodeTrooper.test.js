// code-stats plugin test
const path = require('path');
const rootDir = path.resolve(__dirname, '../..');
describe('CodeTrooper',()=>{let p;beforeAll(()=>{p=require(path.join(rootDir, 'plugins/CodeTrooper.js'));});
test('exports',()=>{expect(p.name).toBe('CodeTrooper');expect(typeof p.execute).toBe('function');});
test('counts files',async()=>{const r=await p.execute({workspacePath:rootDir});expect(r.totalFiles).toBeGreaterThan(0);expect(r.languages.length).toBeGreaterThan(0);});
test('language breakdown',async()=>{const r=await p.execute({workspacePath:rootDir});expect(r.languages[0]).toHaveProperty('lang');expect(r.languages[0]).toHaveProperty('files');});
});
