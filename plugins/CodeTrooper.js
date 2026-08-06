/**
 * LOAD-BEARING — DO NOT DELETE BECAUSE "NOTHING IMPORTS IT".
 *
 * Loaded at runtime by ToolBox.loadPlugins() (backend/infrastructure/ToolBox.js),
 * which readdirSync()s this directory and require()s each .js file. There is no
 * static import anywhere in the codebase, so knip, IDE "unused file" hints, and
 * any basename-matching scan will all report this file as dead. It is not.
 *
 */
/**
 * CodeTrooper — YodaMan plugin: count lines, files, and languages in a workspace.
 */
const fs = require('fs');
const path = require('path');

const EXT_LANG = {
  js:'JavaScript', ts:'TypeScript', jsx:'React JSX', tsx:'React TSX',
  py:'Python', java:'Java', go:'Go', rs:'Rust', dart:'Dart',
  swift:'Swift', kt:'Kotlin', rb:'Ruby', php:'PHP',
  css:'CSS', scss:'SCSS', html:'HTML', json:'JSON', yaml:'YAML', md:'Markdown'
};

module.exports = {
  name: 'CodeTrooper',
  description: 'Count lines of code, files, and languages in a workspace. Returns per-language breakdown and totals. 💡 Chat usage: "How many lines of code?" or "Run CodeTrooper" or "What languages are used here?"',
  permissions: ['read'],
  parameters: {
    workspacePath: { type:'string', required:true, description:'Absolute path to analyze' },
    excludeDirs: { type:'string', default:'node_modules,dist,build,.git,.next,.venv,release,graphify-out,coverage,downloads', description:'Comma-separated dirs to skip' }
  },
  async execute(params = {}) {
    const root = path.resolve(params.workspacePath || process.cwd());
    const skip = new Set((params.excludeDirs || 'node_modules,dist,build,.git,.next,.venv,release,graphify-out,coverage,downloads').split(',').map(s => s.trim()));
    const files = [];
    const walk = (dir, depth=0) => {
      if (depth > 10) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes:true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) { if (!skip.has(e.name)) walk(path.join(dir,e.name), depth+1); }
        else if (e.isFile()) files.push(path.join(dir,e.name));
      }
    };
    walk(root);

    const byLang = {};
    let totalLines = 0, totalFiles = 0;
    for (const f of files) {
      const ext = path.extname(f).slice(1);
      const lang = EXT_LANG[ext] || ext.toUpperCase() || 'Other';
      if (!byLang[lang]) byLang[lang] = { files:0, lines:0 };
      byLang[lang].files++;
      totalFiles++;
      try {
        const content = fs.readFileSync(f, 'utf8');
        const lineCount = content.split('\n').filter(l => l.trim()).length;
        byLang[lang].lines += lineCount;
        totalLines += lineCount;
      } catch (_err) {
        // Unreadable or binary file: exclude it from the line count rather than
        // abandoning the scan of every remaining file.
      }
    }

    const sorted = Object.entries(byLang).sort((a,b) => b[1].lines - a[1].lines).map(([lang, data]) => ({ lang, ...data }));
    return { workspace:root, totalFiles, totalLines, languages:sorted };
  }
};
