// code-stats plugin test
describe('CodeTrooper',()=>{let p;beforeAll(()=>{p=require('/Users/developer/Documents/yodaman/plugins/CodeTrooper.js');});
test('exports',()=>{expect(p.name).toBe('CodeTrooper');expect(typeof p.execute).toBe('function');});
test('counts files',async()=>{const r=await p.execute({workspacePath:'/Users/developer/Documents/yodaman'});expect(r.totalFiles).toBeGreaterThan(0);expect(r.languages.length).toBeGreaterThan(0);});
test('language breakdown',async()=>{const r=await p.execute({workspacePath:'/Users/developer/Documents/yodaman'});expect(r.languages[0]).toHaveProperty('lang');expect(r.languages[0]).toHaveProperty('files');});
});
