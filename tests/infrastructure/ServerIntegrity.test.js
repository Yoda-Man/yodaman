// Server startup + Settings integrity tests
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Server startup',()=>{
test('AgentReasoningEngine loads',()=>{expect(()=>require('../../backend/core/AgentReasoningEngine')).not.toThrow();});
test('ToolBox loads',()=>{expect(()=>require('../../backend/infrastructure/ToolBox')).not.toThrow();});
test('RestController loads',()=>{expect(()=>require('../../backend/interfaces/RestController')).not.toThrow();});
});
describe('SettingsProvider',()=>{
let tempDir;
let previousConfigPath;

beforeEach(()=>{
tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'yodaman-settings-test-'));
previousConfigPath=process.env.YODAMAN_CONFIG_PATH;
process.env.YODAMAN_CONFIG_PATH=path.join(tempDir,'config.json');
const s=require('../../backend/infrastructure/SettingsProvider');
s.reset();
});

afterEach(()=>{
const s=require('../../backend/infrastructure/SettingsProvider');
s.reset();
if(previousConfigPath===undefined){delete process.env.YODAMAN_CONFIG_PATH;}else{process.env.YODAMAN_CONFIG_PATH=previousConfigPath;}
fs.rmSync(tempDir,{recursive:true,force:true});
});

test('defaults',()=>{const s=require('../../backend/infrastructure/SettingsProvider');const a=s.getAll();expect(a.allowPluginUploads).toBe(false);expect(a.allowUnrestrictedPlugins).toBe(false);});
test('save+get',()=>{const s=require('../../backend/infrastructure/SettingsProvider');s.save({allowPluginUploads:true});expect(s.get('allowPluginUploads')).toBe(true);s.save({allowPluginUploads:false});expect(s.get('allowPluginUploads')).toBe(false);});
});
