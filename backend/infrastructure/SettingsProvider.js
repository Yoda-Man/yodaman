/**
 * SettingsProvider — centralized settings store backed by config.json
 */
const fs=require('fs'),path=require('path');
const CFG=path.join(__dirname,'../../config.json');
let C=null;
function L(){if(C)return C;const D={allowPluginUploads:true,allowUnrestrictedPlugins:false,allowAgentCommands:false,requirePairingToken:true};
  try{if(fs.existsSync(CFG)){const r=JSON.parse(fs.readFileSync(CFG,'utf8'));C={...D,...r.settings};}else C={...D};}catch{C={...D};}return C;}
function S(u){const c=L();Object.assign(c,u);C=c;try{let cfg={};if(fs.existsSync(CFG))cfg=JSON.parse(fs.readFileSync(CFG,'utf8'));cfg.settings=c;fs.writeFileSync(CFG,JSON.stringify(cfg,null,2));}catch(e){console.error('[Settings]',e.message);}}
function G(k){const s=L();const ek='YODAMAN_'+k.replace(/([A-Z])/g,'_$1').toUpperCase();const ev=process.env[ek];if(ev!==undefined)return ev==='true'?true:ev==='false'?false:ev;return s[k]!==undefined?s[k]:null;}
function GA(){return{...L()};}
module.exports={get:G,getAll:GA,save:S,load:L};
