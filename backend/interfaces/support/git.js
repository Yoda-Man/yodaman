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
 * @returns {Promise<string>} trimmed stdout
 */
function runGit(dirPath, args) {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd: dirPath, timeout: 5000 }, (err, stdout, stderr) => {
            if (err) {
                // git puts the useful message on stderr; err.message is usually
                // just "Command failed".
                err.message = (stderr || err.message || '').trim() || err.message;
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

module.exports = { runGit, readGitContext };
