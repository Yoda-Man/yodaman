// Server startup + Settings integrity tests
describe('Server startup',()=>{
test('AgentReasoningEngine loads',()=>{expect(()=>require('/Users/developer/Documents/yodaman/backend/core/AgentReasoningEngine')).not.toThrow();});
test('ToolBox loads',()=>{expect(()=>require('/Users/developer/Documents/yodaman/backend/infrastructure/ToolBox')).not.toThrow();});
test('RestController loads',()=>{expect(()=>require('/Users/developer/Documents/yodaman/backend/interfaces/RestController')).not.toThrow();});
});
describe('SettingsProvider',()=>{
test('defaults',()=>{const s=require('/Users/developer/Documents/yodaman/backend/infrastructure/SettingsProvider');const a=s.getAll();expect(a.allowPluginUploads).toBe(true);expect(a.allowUnrestrictedPlugins).toBe(false);});
test('save+get',()=>{const s=require('/Users/developer/Documents/yodaman/backend/infrastructure/SettingsProvider');s.save({allowPluginUploads:false});expect(s.get('allowPluginUploads')).toBe(false);s.save({allowPluginUploads:true});expect(s.get('allowPluginUploads')).toBe(true);});
});
