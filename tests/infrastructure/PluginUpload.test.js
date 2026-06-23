// Plugin upload safety tests
describe('safePluginFilename',()=>{
const RC=require('../../backend/interfaces/RestController');
test('accepts .js',()=>{expect(()=>RC.safePluginFilename('p.js')).not.toThrow();});
test('accepts .zip now',()=>{expect(()=>RC.safePluginFilename('p.zip')).not.toThrow();});
test('rejects path traversal',()=>{expect(()=>RC.safePluginFilename('../p.js')).toThrow();});
test('rejects no extension',()=>{expect(()=>RC.safePluginFilename('plugin')).toThrow();});
});
describe('unzip available',()=>{
test('system unzip works',()=>{const{execSync}=require('child_process');expect(()=>execSync('which unzip',{stdio:'pipe'})).not.toThrow();});
});
