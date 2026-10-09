const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const gitService = require('../../backend/services/gitService');

function git(cwd, args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('gitService', () => {
    let workspace;

    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-git-service-'));
        git(workspace, ['init']);
        git(workspace, ['config', 'user.name', 'Yoda Test']);
        git(workspace, ['config', 'user.email', 'yoda@example.test']);

        fs.writeFileSync(path.join(workspace, 'alpha.js'), 'const alpha = 1;\n');
        git(workspace, ['add', 'alpha.js']);
        git(workspace, ['commit', '-m', 'Add alpha']);

        fs.writeFileSync(path.join(workspace, 'alpha.js'), 'const alpha = 2;\n');
        fs.writeFileSync(path.join(workspace, 'beta.ts'), 'export const beta = true;\n');
        git(workspace, ['add', 'alpha.js', 'beta.ts']);
        git(workspace, ['commit', '-m', 'Update alpha and beta']);
    });

    afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    test('returns commit history with files changed counts', async () => {
        const history = await gitService.getCommitHistory(workspace, 'alpha.js', 10);

        expect(history.length).toBeGreaterThanOrEqual(2);
        expect(history[0]).toEqual(expect.objectContaining({
            hash: expect.any(String),
            author: 'Yoda Test',
            date: expect.any(String),
            message: 'Update alpha and beta',
            filesChanged: expect.any(Number)
        }));
        expect(history[0].filesChanged).toBeGreaterThanOrEqual(1);
    });

    test('returns blame, change frequency, heatmap data, commit diff, and branch info', async () => {
        const blame = await gitService.getFileBlame(workspace, 'alpha.js');
        expect(blame[0]).toEqual(expect.objectContaining({
            line: 1,
            hash: expect.any(String),
            author: 'Yoda Test',
            content: 'const alpha = 2;'
        }));

        const frequency = await gitService.getChangeFrequency(workspace, 'alpha.js', 30);
        expect(frequency).toBeGreaterThanOrEqual(2);

        const heatmap = await gitService.getHeatmapData(workspace);
        expect(heatmap).toEqual(expect.arrayContaining([
            expect.objectContaining({
                filePath: 'alpha.js',
                changeCount: expect.any(Number),
                lastChangeDate: expect.any(String),
                authorCount: 1
            })
        ]));

        const history = await gitService.getCommitHistory(workspace, undefined, 1);
        const diff = await gitService.getCommitDiff(workspace, history[0].hash);
        expect(diff.files).toEqual(expect.arrayContaining([
            expect.objectContaining({ filePath: 'alpha.js' }),
            expect.objectContaining({ filePath: 'beta.ts' })
        ]));

        const branch = await gitService.getBranchInfo(workspace);
        expect(branch).toEqual(expect.objectContaining({
            currentBranch: expect.any(String),
            ahead: expect.any(Number),
            behind: expect.any(Number),
            latestCommit: expect.objectContaining({
                hash: expect.any(String),
                message: 'Update alpha and beta'
            })
        }));
    });

    describe('timeline', () => {
        test('lists commits oldest first, with each file and whether it was added or modified', async () => {
            const { commits, truncated } = await gitService.getTimeline(workspace);
            expect(truncated).toBe(false);
            expect(commits).toHaveLength(2);
            expect(commits[0].files).toEqual([{ path: 'alpha.js', status: 'A' }]);
            expect(commits[1].files).toEqual(expect.arrayContaining([
                { path: 'alpha.js', status: 'M' },
                { path: 'beta.ts', status: 'A' }
            ]));
            expect(Date.parse(commits[0].date)).toBeLessThanOrEqual(Date.parse(commits[1].date));
            expect(commits[0].author).toBe('Yoda Test');
        });

        test('reports paths relative to a workspace that is a subfolder of the repository', async () => {
            // Git's own paths start at the repository root; the graph's start at
            // the workspace. --relative makes them agree.
            fs.mkdirSync(path.join(workspace, 'core'));
            fs.writeFileSync(path.join(workspace, 'core', 'gamma.js'), 'gamma\n');
            git(workspace, ['add', 'core/gamma.js']);
            git(workspace, ['commit', '-m', 'Add gamma']);

            const { commits } = await gitService.getTimeline(path.join(workspace, 'core'));
            expect(commits).toHaveLength(1);
            expect(commits[0].files).toEqual([{ path: 'gamma.js', status: 'A' }]);
        });

        test('is bounded', async () => {
            const { commits, truncated } = await gitService.getTimeline(workspace, { maxCommits: 1 });
            expect(commits).toHaveLength(1);
            expect(truncated).toBe(true);
        });
    });
});
