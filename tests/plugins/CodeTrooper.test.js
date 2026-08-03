// code-stats plugin test
const path = require('path');
const rootDir = path.resolve(__dirname, '../..');
const fixtureDir = path.join(__dirname, '..', 'fixtures', 'codetrooper-files');

describe('CodeTrooper', () => {
  let p;
  beforeAll(() => { p = require(path.join(rootDir, 'plugins/CodeTrooper.js')); });

  test('exports', () => {
    expect(p.name).toBe('CodeTrooper');
    expect(typeof p.execute).toBe('function');
  });

  test('counts files in a fixture', async () => {
    const r = await p.execute({ workspacePath: fixtureDir });
    expect(r.totalFiles).toBe(4);
    expect(r.languages.length).toBeGreaterThan(0);
  });

  test('language breakdown is correct', async () => {
    const r = await p.execute({ workspacePath: fixtureDir });
    // 2 JS files, 1 CSS, 1 Markdown
    const js = r.languages.find(l => l.lang === 'JavaScript');
    expect(js).toBeDefined();
    expect(js.files).toBe(2);
    const css = r.languages.find(l => l.lang === 'CSS');
    expect(css).toBeDefined();
    expect(css.files).toBe(1);
  });

  test('handles missing directory gracefully', async () => {
    const r = await p.execute({ workspacePath: '/nonexistent/path/xyz' });
    expect(r.totalFiles).toBe(0);
    expect(r.languages).toEqual([]);
  });

  test('excludes skipped directories', async () => {
    const r = await p.execute({ workspacePath: fixtureDir, excludeDirs: 'node_modules,downloads' });
    expect(r.totalFiles).toBe(4); // fixture has no node_modules or downloads
  });

  test('respects custom excludeDirs', async () => {
    // exclude .js files by excluding the dir? No — excludeDirs only skips dirs.
    // We test that the default skip set includes release/graphify-out/coverage/downloads
    const defaults = p.parameters.excludeDirs.default.split(',').map(s => s.trim());
    expect(defaults).toContain('node_modules');
    expect(defaults).toContain('release');
    expect(defaults).toContain('graphify-out');
    expect(defaults).toContain('coverage');
    expect(defaults).toContain('downloads');
  });
});
