/**
 * The directories YodaMan generates inside a workspace, and the one it must
 * never touch.
 *
 * WHY THESE ARE NAMED IN ONE PLACE.
 *
 * `.yodaman-doc-chunks` was already written in three files — `docPreprocessor`
 * defines it, `shared/ignoredPaths` excludes it, and `QueueService` comments on
 * it. `graphify-out` is in as many. That is precisely the shape of the drift
 * that split one ignore list into four and leaked file descriptors until the
 * process ran out.
 *
 * `yodaman uninstall` DELETES what is listed here, so a stale or wrong entry is
 * far more expensive than a stale ignore rule. `tests/shared/GeneratedPaths.test.js`
 * reads the defining modules and fails if these names stop matching what the
 * code actually writes.
 *
 * THE EXCLUSION MATTERS AS MUCH AS THE LIST.
 *
 * `openspec/` sits in a workspace and looks generated. It is not: those are
 * specs the USER wrote, and YodaMan only ever reads them. Deleting it during an
 * uninstall would destroy original work that exists nowhere else. It is named
 * here so that removing it from the protected list requires deleting a test.
 */

/** Document chunks — mirrors OUTPUT_DIR in backend/utils/docPreprocessor.js. */
const DOC_CHUNKS_DIR = '.yodaman-doc-chunks';

/** Graphify's graph and AST cache — mirrors backend/infrastructure/GraphifyService.js. */
const GRAPH_OUT_DIR = 'graphify-out';

/** Per-workspace directories YodaMan creates and may therefore remove. */
const GENERATED_WORKSPACE_DIRS = [DOC_CHUNKS_DIR, GRAPH_OUT_DIR];

/** Home-relative state — mirrors logDir() in backend/infrastructure/Logger.js. */
const HOME_STATE_DIR = '.yodaman';

/**
 * Written by the user, read by YodaMan. Never removed, never suggested for
 * removal. See the note above.
 */
const USER_OWNED_DIRS = ['openspec'];

/**
 * Files the runtime keeps inside its own install directory. Listed for
 * reporting only: `npm uninstall -g yodaman` removes the whole directory, so
 * nothing here is deleted individually.
 */
const INSTALL_DIR_STATE = [
    'config.json',
    'sessions.json',
    'audit-log.json',
    'audit-log.jsonl',
    'task-history.json',
    'task-history.jsonl'
];

/** True if a directory name is one the user owns and we must not remove. */
function isUserOwned(name) {
    return USER_OWNED_DIRS.includes(String(name));
}

module.exports = {
    DOC_CHUNKS_DIR,
    GRAPH_OUT_DIR,
    GENERATED_WORKSPACE_DIRS,
    HOME_STATE_DIR,
    USER_OWNED_DIRS,
    INSTALL_DIR_STATE,
    isUserOwned
};
