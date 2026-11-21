/**
 * Git subprocess helpers shared by the git routes and the /ask context builder.
 *
 * Extracted from RestController.js during the W-6 split.
 */
const { execFile } = require('child_process');

/**
 * Runs one git command in `dirPath` and resolves its trimmed stdout.
 *
 * execFile with an argv array — never a shell string — so branch names, paths,
 * and commit messages cannot be reinterpreted as shell syntax.
 *
 * @param {string} dirPath - Working directory (already validated by the caller).
 * @param {string[]} args  - git arguments.
 * @param {{timeout?: number}} [options] - local reads keep the 5 s default;
 *   push and pull pass NETWORK_TIMEOUT_MS, since a slow remote is not a hang.
 * @returns {Promise<string>} trimmed stdout
 */
function runGit(dirPath, args, { timeout = 5000 } = {}) {
    return new Promise((resolve, reject) => {
        // No terminal prompts: the runtime has nobody to answer one, so a
        // remote needing credentials fails at once instead of at the timeout.
        const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
        execFile('git', args, { cwd: dirPath, timeout, env }, (err, stdout, stderr) => {
            if (err) {
                // git puts the useful message on stderr, except "nothing to
                // commit", which goes to stdout; err.message is usually just
                // "Command failed".
                err.message = String(stderr || stdout || '').trim() || err.message;
                reject(err);
                return;
            }
            resolve(String(stdout || '').trim());
        });
    });
}

/**
 * Branch, ahead/behind counts, and the last 8 commits for a workspace.
 *
 * The log call tolerates failure (`.catch(() => '')`): a repository with no
 * commits yet is a valid state, and should still report its branch.
 */
async function readGitContext(dirPath) {
    const [branch, status, commits] = await Promise.all([
        runGit(dirPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
        runGit(dirPath, ['status', '--porcelain=v2', '--branch']),
        runGit(dirPath, ['log', '--pretty=format:%h%x09%s%x09%cr', '-n', '8']).catch(() => '')
    ]);

    const branchLine = status.split('\n').find(line => line.startsWith('# branch.ab '));
    const [, ahead = '+0', behind = '-0'] = branchLine?.match(/# branch\.ab (\+\d+) (-\d+)/) || [];

    return {
        branch,
        ahead: Number(ahead.replace('+', '')) || 0,
        behind: Math.abs(Number(behind.replace('-', ''))) || 0,
        recentCommits: commits
            .split('\n')
            .filter(Boolean)
            .map(line => {
                const [hash, subject, relativeTime] = line.split('\t');
                return { hash, subject, relativeTime };
            })
    };
}

/** Push and pull talk to a remote; give them minutes, not seconds. */
const NETWORK_TIMEOUT_MS = 10 * 60 * 1000;

module.exports = { runGit, readGitContext, NETWORK_TIMEOUT_MS };
