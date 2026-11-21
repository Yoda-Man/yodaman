/**
 * The git mutation routes change a repository, so they get the guards a write
 * needs:
 *
 *   - only a registered workspace can be changed (404 workspace_not_registered),
 *   - request values are never read as git options (`files` go after `--`, a
 *     branch may not start with `-`),
 *   - a bad request is a 400 with a code, and a git failure carries one too,
 *   - "nothing to commit" is reported, not turned into an empty commit,
 *   - push and pull are not killed by the 5 s timeout meant for local reads.
 *
 * Every test runs real git in a temporary repository.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const router = require('../../backend/interfaces/routes/gitRoutes');
const { findRouteHandler } = require('../helpers/routeHandler');

function git(cwd, args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function post(route, body) {
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; }
    };
    await findRouteHandler(router, 'post', route)({ body }, res);
    return res;
}

describe('git mutation routes', () => {
    let root;
    let repo;
    let previousConfigPath;

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-git-routes-')));
        repo = path.join(root, 'repo');
        fs.mkdirSync(repo);
        git(repo, ['init', '-q']);
        git(repo, ['config', 'user.name', 'Yoda Test']);
        git(repo, ['config', 'user.email', 'yoda@example.test']);
        fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
        git(repo, ['add', 'a.txt']);
        git(repo, ['commit', '-q', '-m', 'first']);

        previousConfigPath = process.env.YODAMAN_CONFIG_PATH;
        process.env.YODAMAN_CONFIG_PATH = path.join(root, 'config.json');
        fs.writeFileSync(process.env.YODAMAN_CONFIG_PATH, JSON.stringify({ watchedDirectories: [repo], removedDirectories: [] }));
    });

    afterEach(() => {
        if (previousConfigPath === undefined) delete process.env.YODAMAN_CONFIG_PATH;
        else process.env.YODAMAN_CONFIG_PATH = previousConfigPath;
        fs.rmSync(root, { recursive: true, force: true });
    });

    test.each([
        ['/git/commit', { message: 'x' }],
        ['/git/push', {}],
        ['/git/pull', {}],
        ['/git/branch', { branch: 'feature' }]
    ])('%s refuses a folder that is not a registered workspace', async (route, body) => {
        const other = path.join(root, 'other');
        fs.mkdirSync(other);
        git(other, ['init', '-q']);
        const res = await post(route, { path: other, ...body });
        expect(res.statusCode).toBe(404);
        expect(res.payload).toEqual(expect.objectContaining({ ok: false, code: 'workspace_not_registered' }));
        expect(git(other, ['branch', '--list', 'feature'])).toBe('');
    });

    test.each([
        ['/git/commit', {}, 'message must be a non-empty string'],
        ['/git/commit', { message: 'x', files: 'a.txt' }, 'files must be a non-empty array of paths'],
        ['/git/branch', {}, 'branch must be a non-empty string'],
        ['/git/push', { path: undefined }, 'path must be a non-empty string']
    ])('%s with a missing or bad field is a 400 with a code', async (route, body, error) => {
        const res = await post(route, { path: repo, ...body });
        expect(res.statusCode).toBe(400);
        expect(res.payload).toEqual({ ok: false, error, code: 'invalid_request' });
    });

    test('a file name starting with "-" is staged as a path, not read as an option', async () => {
        // Read as an option, "-A" would stage every change, other.txt included.
        fs.writeFileSync(path.join(repo, '-A'), 'dash\n');
        fs.writeFileSync(path.join(repo, 'other.txt'), 'not asked for\n');
        const res = await post('/git/commit', { path: repo, message: 'dash file', files: ['-A'] });
        expect(res.payload).toEqual(expect.objectContaining({ ok: true }));
        expect(git(repo, ['show', '--name-only', '--format=', 'HEAD'])).toBe('-A');
    });

    test('a branch name starting with "-" is refused', async () => {
        const res = await post('/git/branch', { path: repo, branch: '--orphan=x' });
        expect(res.statusCode).toBe(400);
        expect(res.payload).toEqual({ ok: false, error: 'branch must not start with "-"', code: 'invalid_request' });
    });

    test('a new branch is created and checked out', async () => {
        const res = await post('/git/branch', { path: repo, branch: 'feature/x' });
        expect(res.payload).toEqual({ ok: true, branch: 'feature/x' });
        expect(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feature/x');
    });

    test('nothing to commit is an error with a code, not an empty commit', async () => {
        const before = git(repo, ['rev-parse', 'HEAD']);
        const res = await post('/git/commit', { path: repo, message: 'empty' });
        expect(res.statusCode).toBe(500);
        expect(res.payload).toEqual(expect.objectContaining({ ok: false, code: 'git_commit_failed' }));
        expect(res.payload.error).toMatch(/nothing to commit/);
        expect(git(repo, ['rev-parse', 'HEAD'])).toBe(before);
    });

    test('a commit answers the branch and short hash', async () => {
        fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
        const res = await post('/git/commit', { path: repo, message: 'change a' });
        expect(res.payload).toEqual({
            ok: true,
            branch: git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']),
            hash: git(repo, ['rev-parse', '--short=7', 'HEAD'])
        });
    });

    test('a push slower than 5 seconds is not killed', async () => {
        const remote = path.join(root, 'remote.git');
        git(root, ['init', '-q', '--bare', remote]);
        const hook = path.join(remote, 'hooks', 'pre-receive');
        fs.writeFileSync(hook, '#!/bin/sh\nsleep 6\n');
        fs.chmodSync(hook, 0o755);
        git(repo, ['remote', 'add', 'origin', remote]);
        git(repo, ['push', '-q', '-u', 'origin', 'HEAD']);
        fs.writeFileSync(path.join(repo, 'a.txt'), 'slow\n');
        git(repo, ['commit', '-q', '-am', 'slow push']);

        const res = await post('/git/push', { path: repo });
        expect(res.payload).toEqual(expect.objectContaining({ ok: true }));
        expect(git(remote, ['rev-parse', 'HEAD'])).toBe(git(repo, ['rev-parse', 'HEAD']));
    }, 30_000);
});
