/**
 * PluginAPI — Full API contract for legacy plugins (Holocron VR style)
 */
const path=require('path'),{Worker}=require('worker_threads');
class PluginAPI{
  constructor(dir){this.pluginDir=dir;this.workers=new Set();this.shortcuts=new Set();this._log=console;}
  async fetch(url,opts={}){
    const m=require(url.startsWith('https')?'https':'http');
    return new Promise((res,rej)=>{
      const r=m.request(url,opts,(resp)=>{let d='';resp.on('data',c=>d+=c);resp.on('end',()=>res({ok:resp.statusCode<400,status:resp.statusCode,json:async()=>JSON.parse(d),text:async()=>d}));});
      r.on('error',rej);if(opts.body)r.write(opts.body);r.end();
    });
  }
  get log(){return{info:(...a)=>this._log.log('[Plugin]',...a),warn:(...a)=>this._log.warn('[Plugin]',...a),error:(...a)=>this._log.error('[Plugin]',...a)};}
  get ui(){const s=this;return{registerPluginCard:c=>s._log.log('[PluginAPI] Card:',c.label),openModal:o=>s._log.log('[PluginAPI] Modal:',o.title||o.id),registerShortcut:k=>{s.shortcuts.add(k.id);s._log.log('[PluginAPI] Shortcut:',k.label);},unregisterShortcut:id=>{s.shortcuts.delete(id);s._log.log('[PluginAPI] Unregister:',id);}};}
  get worker(){const s=this;return{run:(sp,opts)=>s._log.log('[PluginAPI] Worker:',sp),terminateAll:()=>s.workers.clear()};}
  get config(){return{get:()=>null};}
}
module.exports=PluginAPI;
