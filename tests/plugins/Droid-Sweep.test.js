// find-unused plugin test
describe('Droid-Sweep',()=>{let p;beforeAll(()=>{p=require('/Users/developer/Documents/yodaman/plugins/Droid-Sweep.js');});
test('exports',()=>{expect(p.name).toBe('Droid-Sweep');expect(typeof p.execute).toBe('function');});
test('scans for unused',async()=>{const r=await p.execute({workspacePath:'/Users/developer/Documents/yodaman'});expect(r).toHaveProperty('totalFiles');expect(r).toHaveProperty('unusedCount');});
test('file details',async()=>{const r=await p.execute({workspacePath:'/Users/developer/Documents/yodaman'});if(r.unusedCount>0){expect(r.unusedFiles[0]).toHaveProperty('filePath');}});
});
