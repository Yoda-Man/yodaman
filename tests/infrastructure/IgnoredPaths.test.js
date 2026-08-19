/**
 * Guards the one list that decides what is never watched and never indexed.
 *
 * The bug this exists to prevent: the watcher and the indexer each kept their
 * own copy, the copies drifted, and neither listed `.yodaman-doc-chunks` — a
 * directory YodaMan generates itself. A four-minute-old runtime held 10,307
 * open file descriptors, 5,264 of them chunk files. A process that fills its
 * descriptor table cannot allocate pipes, so `spawn` fails with EBADF and the
 * agent silently loses the ability to run any tool.
 *
 * So these tests assert two things a reviewer cannot eyeball: that both
 * consumers read the same list, and that everything YodaMan itself writes is
 * on it.
 */
const fs = require('fs');
const path = require('path');
const { IGNORED_DIRECTORIES, isIgnoredPath } = require('../../shared/ignoredPaths');

describe('ignored paths', () => {
    /**
     * Directories the product creates inside a user's workspace. Watching or
     * indexing our own output is what caused the descriptor leak, and it also
     * feeds generated text back into search results.
     */
    const GENERATED_BY_YODAMAN = ['graphify-out', '.yodaman-doc-chunks', '.yodaman-approval-smoke'];

    it.each(GENERATED_BY_YODAMAN)('ignores %s, which YodaMan generates itself', (dir) => {
        expect(IGNORED_DIRECTORIES).toContain(dir);
    });

    it('ignores vendored and build output', () => {
        for (const dir of ['node_modules', '.git', 'dist', 'build', 'release', 'coverage']) {
            expect(IGNORED_DIRECTORIES).toContain(dir);
        }
    });

    it('matches an ignored directory at any depth, not just the top level', () => {
        expect(isIgnoredPath('.yodaman-doc-chunks/a.doc-chunk')).toBe(true);
        expect(isIgnoredPath('packages/app/node_modules/lib/index.js')).toBe(true);
        expect(isIgnoredPath('src/backend/server.js')).toBe(false);
    });

    it('does not ignore a path that merely contains an ignored name as a substring', () => {
        // "build" must not swallow "buildTools", the way an earlier substring
        // match on a plugin capability turned "audit:write" into "can modify".
        expect(isIgnoredPath('src/buildTools/compile.js')).toBe(false);
        expect(isIgnoredPath('src/distribution/index.js')).toBe(false);
    });

    /**
     * The conservatism guard. Each of these is generated output in one
     * ecosystem and hand-written source in another. Refusing to index a user's
     * source is a worse failure than watching some build output, so if someone
     * adds one of these to buy back descriptors, this test should stop them.
     */
    it.each(['bin', 'packages', 'target', 'src', 'lib', 'app'])(
        'does not ignore %s, which is real source in some projects',
        (dir) => {
            expect(IGNORED_DIRECTORIES).not.toContain(dir);
        }
    );

    /**
     * The drift guard. Both files must read the shared module rather than
     * declare a list of their own — a second literal array is exactly how the
     * two got out of sync before.
     */
    it.each([
        ['backend/infrastructure/FileSystemWatcher.js', 'the watcher'],
        ['backend/core/QueueService.js', 'the indexer']
    ])('%s reads the shared list rather than declaring its own', (relPath) => {
        const source = fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8');
        expect(source).toMatch(/require\(['"].*shared\/ignoredPaths['"]\)/);
        expect(source).not.toMatch(/const\s+(IGNORED_DIRECTORIES|INDEX_IGNORE_PATTERNS)\s*=\s*\[/);
    });

    it('the watcher applies the shared list to real paths', () => {
        const watcher = require('../../backend/infrastructure/FileSystemWatcher');
        const root = '/workspace';
        expect(watcher.isIgnored('/workspace/.yodaman-doc-chunks/a.doc-chunk', root)).toBe(true);
        expect(watcher.isIgnored('/workspace/src/index.js', root)).toBe(false);
        // The watch root itself is never self-ignored, whatever it is named.
        expect(watcher.isIgnored(root, root)).toBe(false);
    });
});
