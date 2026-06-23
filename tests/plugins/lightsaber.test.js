// Lightsaber plugin test
const path = require('path');
const rootDir = path.resolve(__dirname, '../..');
describe('lightsaber',()=>{
  let p;
  beforeAll(()=>{p=require(path.join(rootDir, 'plugins/lightsaber.js'));});
  test('exports',()=>{expect(p.name).toBe('lightsaber');expect(typeof p.execute).toBe('function');});
  test('permissions',()=>{expect(p.permissions).toContain('read');expect(p.permissions).toContain('search');});
  test('requires workspacePath',async()=>{await expect(p.execute({action:'analyze'})).rejects.toThrow('workspacePath');});
  test('rejects unknown action',async()=>{await expect(p.execute({action:'bogus',workspacePath:'/tmp'})).rejects.toThrow('Unknown action');});
  test('find-todos',async()=>{const r=await p.execute({action:'find-todos',workspacePath:rootDir});expect(r).toHaveProperty('total');});
  test('test-coverage',async()=>{const r=await p.execute({action:'test-coverage',workspacePath:rootDir});expect(r).toHaveProperty('ratio');});
});
