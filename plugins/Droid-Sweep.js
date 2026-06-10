/**
 * Droid-Sweep — YodaMan plugin: find potentially unused files in a JS/TS project.
 * @author Marwa Trust Mutemasango <trustaldo@gmail.com>
 */
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'Droid-Sweep',
  description: 'Find potentially unused files by scanning import/require/reference patterns. Helps detect dead code that can be safely removed. 💡 Chat usage: "Find unused files" or "Run Droid Sweep" or "Clean up dead code"',
  permissions: ['read'],
  parameters: {
    workspacePath: { type:'string', required:true, description:'Absolute path to scan' },
    extensions: { type:'string', default:'.js,.ts,.jsx,.tsx', description:'Comma-separated extensions' },
    excludeDirs: { type:'string', default:'node_modules,dist,build,.git,.next,.venv', description:'Comma-separated dirs to skip' }
  },
  async execute(params = {}) {
    const root = path.resolve(params.workspacePath || process.cwd());
    const exts = new Set((params.extensions||'.js,.ts,.jsx,.tsx').split(',').map(s=>s.trim()));
    const skip = new Set((params.excludeDirs||'node_modules,dist,build,.git,.next,.venv').split(',').map(s=>s.trim()));
    const allFiles = [];
    const walk = (dir,d=0) => { if(d>10)return; let e; try{e=fs.readdirSync(dir,{withFileTypes:true})}catch{return}; for(const f of e){ const p=path.join(dir,f.name); if(f.isDirectory()){if(!skip.has(f.name))walk(p,d+1)}else if(f.isFile()&&exts.has(path.extname(f.name)))allFiles.push(p); } };
    walk(root);

    const cm = {}; for(const f of allFiles) { try{cm[f]=fs.readFileSync(f,'utf8')}catch{cm[f]=''} }
    const refd = new Set(), rootFiles = new Set(['index.js','index.ts','main.js','main.ts','app.js','app.tsx','index.jsx','index.tsx']);
    for(const f of allFiles) if(rootFiles.has(path.basename(f))) refd.add(f);

    for(const [fp, c] of Object.entries(cm)) {
      const base = path.basename(fp).replace(path.extname(fp),'');
      const rx = new RegExp(`['"\`](\\.\\.?/.*?)?${base}['"\`]`,'g'); let m;
      while((m=rx.exec(c))!==null) {
        const ip = m[1] ? m[1]+base : base;
        if(ip.startsWith('.')) {
          const d = path.dirname(fp), r = path.resolve(d, ip);
          for(const e of exts) { if(fs.existsSync(r+e)) refd.add(r+e); if(fs.existsSync(path.join(r,`index${e}`))) refd.add(path.join(r,`index${e}`)); }
        }
      }
    }

    const unused = allFiles.filter(f => !refd.has(f)).map(f => ({ filePath:f.replace(root,'').replace(/^\//,''), size:(cm[f]||'').length, loc:(cm[f]||'').split('\n').length }));
    return { workspace:root, totalFiles:allFiles.length, unusedCount:unused.length, unusedFiles:unused.sort((a,b)=>b.loc-a.loc).slice(0,50) };
  }
};
