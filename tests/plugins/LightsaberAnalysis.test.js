/**
 * lightsaber's analysis, against a fake git history so every number is known.
 *
 * Each case is a bug that shipped: shell strings built from workspacePath,
 * daysToAnalyze never read, a complexity regex that threw on every file (so no
 * hotspot was ever reported), coupling capped at 50%, unanchored exclude
 * globs, node_modules tests in the coverage ratio, and file-only actions that
 * refused to run without git.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../backend/services/gitService', () => ({
    getHeatmapData: jest.fn(),
    getCommitHistory: jest.fn(),
    getCommitDiff: jest.fn()
}));
jest.mock('../../backend/infrastructure/GraphFacts', () => ({ coverageByFile: () => new Map(), load: () => null }));

const gitService = require('../../backend/services/gitService');
const lightsaber = require('../../plugins/lightsaber');

const DAY = 24 * 60 * 60 * 1000;
let ws;

beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsaber-'));
    jest.clearAllMocks();
});
afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

test('a workspace path is an argument, never shell text', async () => {
    const marker = path.join(ws, 'pwned');
    const hostile = path.join(ws, `x"; touch "${marker}`);
    await lightsaber.execute({ action: 'find-todos', workspacePath: hostile });
    await lightsaber.execute({ action: 'test-coverage', workspacePath: hostile });
    expect(fs.existsSync(marker)).toBe(false);
});

test('daysToAnalyze sets the heatmap window and the commits sampled for coupling', async () => {
    gitService.getHeatmapData.mockResolvedValue([]);
    gitService.getCommitHistory.mockResolvedValue([
        { hash: 'new', date: new Date(Date.now() - 2 * DAY).toISOString() },
        { hash: 'old', date: new Date(Date.now() - 20 * DAY).toISOString() }
    ]);
    gitService.getCommitDiff.mockResolvedValue({ files: [{ filePath: 'a.js' }, { filePath: 'b.js' }] });

    const result = await lightsaber.execute({ action: 'coupling', workspacePath: ws, daysToAnalyze: 7 });
    expect(gitService.getHeatmapData).not.toHaveBeenCalled();
    expect(gitService.getCommitDiff.mock.calls.map(([, hash]) => hash)).toEqual(['new']);
    expect(result.couplingEdges[0]).toMatchObject({ coChangeCount: 1, strength: 100 });

    await lightsaber.execute({ action: 'find-hotspots', workspacePath: ws, daysToAnalyze: 7 });
    expect(gitService.getHeatmapData).toHaveBeenCalledWith(ws, 7);
});

test('coupling strength reaches 100% when every diffed commit touches both files', async () => {
    const commits = Array.from({ length: 200 }, (_, i) => ({ hash: `c${i}`, date: new Date().toISOString() }));
    gitService.getCommitHistory.mockImplementation(async (_ws, _file, limit) => commits.slice(0, limit));
    gitService.getCommitDiff.mockResolvedValue({ files: [{ filePath: 'a.js' }, { filePath: 'b.js' }] });
    const result = await lightsaber.execute({ action: 'coupling', workspacePath: ws });
    expect(result.couplingEdges[0].strength).toBe(100);
});

test('a complex, churning file is reported as a hotspot', async () => {
    const branches = Array.from({ length: 150 }, (_, i) => `if (a${i} && b || c ? d : e) { x?.y ?? z; }`).join('\n');
    fs.writeFileSync(path.join(ws, 'hot.js'), branches);
    gitService.getHeatmapData.mockResolvedValue([{ filePath: 'hot.js', changeCount: 50, lastChangeDate: new Date().toISOString(), authorCount: 1 }]);
    const result = await lightsaber.execute({ action: 'analyze', workspacePath: ws });
    expect(result.complexityData['hot.js'].cyclomaticComplexity).toBe(200);
    expect(result.hotspots.map((h) => h.path)).toEqual(['hot.js']);
});

test('exclude globs match whole names, so *.lock keeps src/clock.js', async () => {
    fs.mkdirSync(path.join(ws, 'src'));
    fs.writeFileSync(path.join(ws, 'src', 'clock.js'), 'x');
    gitService.getHeatmapData.mockResolvedValue(['src/clock.js', 'yarn.lock', 'node_modules/pkg/i.js', 'pkg/node_modules/q/i.js']
        .map((filePath) => ({ filePath, changeCount: 1, lastChangeDate: new Date().toISOString(), authorCount: 1 })));
    const result = await lightsaber.execute({ action: 'analyze', workspacePath: ws });
    expect(result.changeData.map((c) => c.path)).toEqual(['src/clock.js']);
});

test('test-coverage ignores the tests that ship inside node_modules', async () => {
    fs.writeFileSync(path.join(ws, 'app.js'), 'x');
    fs.mkdirSync(path.join(ws, 'node_modules', 'dep'), { recursive: true });
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(ws, 'node_modules', 'dep', `t${i}.test.js`), 'x');
    const result = await lightsaber.execute({ action: 'test-coverage', workspacePath: ws });
    expect(result).toMatchObject({ method: 'file-count-fallback', testFiles: 0, sourceFiles: 1, ratio: 0 });
});

test('find-todos and test-coverage run without git', async () => {
    // A fresh plugin whose gitService fails to load, as outside a YodaMan checkout.
    jest.resetModules();
    jest.doMock('../../backend/services/gitService', () => { throw new Error('no git'); });
    const cwd = process.cwd();
    process.chdir(ws); // the plugin's cwd-relative fallback must miss too
    let plugin;
    try { plugin = require('../../plugins/lightsaber'); } finally { process.chdir(cwd); }
    fs.writeFileSync(path.join(ws, 'a.js'), '// TODO: one\n');
    await expect(plugin.execute({ action: 'coupling', workspacePath: ws })).rejects.toThrow(/gitService/);
    await expect(plugin.execute({ action: 'find-todos', workspacePath: ws })).resolves.toMatchObject({ total: 1 });
    await expect(plugin.execute({ action: 'test-coverage', workspacePath: ws })).resolves.toHaveProperty('ratio');
});
