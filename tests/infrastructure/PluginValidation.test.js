// Mode API + plugin validation tests
describe('Plugin validation',()=>{
test('validatePlugin rejects no execute',()=>{const tb=require('../../backend/infrastructure/ToolBox');expect(()=>tb.validatePlugin({name:'x'})).toThrow('execute');});
test('validatePlugin accepts valid',()=>{const tb=require('../../backend/infrastructure/ToolBox');expect(()=>tb.validatePlugin({name:'x',execute:()=>{}})).not.toThrow();});
test('validatePlugin rejects bad permissions',()=>{const tb=require('../../backend/infrastructure/ToolBox');expect(()=>tb.validatePlugin({name:'x',execute:()=>{},permissions:['invalid']},{requireExplicitPermissions:true})).toThrow('unsupported');});
});
