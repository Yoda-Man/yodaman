// Lightsaber plugin test
describe('lightsaber',()=>{
  let p;
  beforeAll(()=>{p=require('/Users/developer/Documents/yodaman/plugins/lightsaber.js');});
  test('exports',()=>{expect(p.name).toBe('lightsaber');expect(typeof p.execute).toBe('function');});
  test('permissions',()=>{expect(p.permissions).toContain('read');expect(p.permissions).toContain('search');});
  test('requires workspacePath',async()=>{await expect(p.execute({action:'analyze'})).rejects.toThrow('workspacePath');});
  test('rejects unknown action',async()=>{await expect(p.execute({action:'bogus',workspacePath:'/tmp'})).rejects.toThrow('Unknown action');});
  test('find-todos',async()=>{const r=await p.execute({action:'find-todos',workspacePath:'/Users/developer/Documents/yodaman'});expect(r).toHaveProperty('total');});
  test('test-coverage',async()=>{const r=await p.execute({action:'test-coverage',workspacePath:'/Users/developer/Documents/yodaman'});expect(r).toHaveProperty('ratio');});
});
