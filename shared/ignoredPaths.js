/**
 * Directories that are never watched and never indexed.
 *
 * This is one list on purpose. It used to be two — FileSystemWatcher had its
 * own array and QueueService had another — and they drifted: the watcher never
 * learned about `coverage`, and NEITHER of them knew about
 * `.yodaman-doc-chunks`, which YodaMan generates itself.
 *
 * The cost of that omission was not a slow index. A runtime four minutes old
 * held 10,307 open file descriptors, 5,264 of them chunk files under a single
 * workspace's `.yodaman-doc-chunks`. Once a process fills its descriptor table
 * it can no longer allocate pipes, so `spawn` starts failing with EBADF — and
 * the agent loses the ability to run ctx, graphify, or any plugin at all. The
 * symptom shows up nowhere near the cause: tools simply stop working on a
 * long-running desktop app.
 *
 * Deliberately absent: `bin`, `packages`, and `target`. Each is build output
 * in one ecosystem and hand-written source in another — `bin/` holds CLI entry
 * points in Node projects, `packages/` is where monorepo source lives. Silently
 * refusing to index a user's source is a worse failure than watching some
 * output, so an entry only earns its place here when it is generated
 * everywhere it appears.
 *
 * Anything derived from the workspace belongs here. Indexing our own output
 * also feeds generated text back into search, which is its own quiet harm.
 */
const IGNORED_DIRECTORIES = [
    '.git',
    'node_modules',
    'dist',
    'build',
    'release',
    'coverage',
    'graphify-out',
    '.yodaman-doc-chunks',
    '.yodaman-approval-smoke',
    // .NET and Visual Studio build output. `obj/Debug` and `obj/Release` alone
    // accounted for 169 held descriptors in one registered workspace.
    'obj',
    '.vs',
    // Python
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.venv',
    'venv',
    // JS/TS build caches
    '.next',
    '.nuxt',
    '.turbo',
    '.parcel-cache',
    '.cache',
    // Vendored dependency trees
    'vendor',
    'third_party',
    'bower_components',
    'Pods',
    '.gradle',
    '.terraform'
];

/**
 * True when any path segment names an ignored directory.
 * @param {string} relativePath - Path relative to the workspace root.
 */
function isIgnoredPath(relativePath) {
    if (!relativePath) return false;
    return relativePath.split(/[\\/]/).some((segment) => IGNORED_DIRECTORIES.includes(segment));
}

module.exports = { IGNORED_DIRECTORIES, isIgnoredPath };
