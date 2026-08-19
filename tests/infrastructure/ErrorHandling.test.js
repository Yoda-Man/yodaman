const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Every caught error is either used or explained.
 *
 * The audit that produced this found 41 catch blocks that discarded an error
 * with no logging and no explanation. Two of them mattered a great deal: a
 * malformed config.json silently reverted every setting to its default, and
 * silently emptied the watched directories, so a user opened YodaMan to find
 * their projects gone with nothing anywhere saying why.
 *
 * Most of the rest were legitimate — a stat on a file that may not exist, a
 * probe whose whole purpose is to answer yes or no — but "legitimate" and
 * "silent" are indistinguishable to the next reader. This makes the difference
 * explicit: a block either handles the error, or says why there is nothing to
 * handle.
 *
 * A block passes when it does any of:
 *   - logs (logger.error / warn / info)
 *   - rethrows
 *   - uses the bound error
 *   - carries a comment, inside the block or immediately above it
 *
 * The comment requirement is not box-ticking. Writing one forces the question
 * "is silence actually correct here?", which is exactly the question nobody
 * asked for those two config bugs.
 */
describe('Error handling', () => {
    const root = path.resolve(__dirname, '../..');

    /** Strip comments and strings so a `catch {}` inside prose is not analysed. */
    function stripNonCode(src) {
        return src
            .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
            .replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
    }

    function analyse() {
        const files = execSync(
            "git ls-files 'backend/**/*.js' 'server.js' 'shared/*.js' 'electron/*.js' 'bin/*.js' 'scripts/*.js'",
            { cwd: root, encoding: 'utf8' }
        ).split('\n').filter(Boolean);

        const silent = [];
        let total = 0;

        for (const file of files) {
            const raw = fs.readFileSync(path.join(root, file), 'utf8');
            const code = stripNonCode(raw);
            const re = /catch\s*(?:\(([^)]*)\))?\s*\{/g;
            let m;

            while ((m = re.exec(code))) {
                total++;
                const binding = (m[1] || '').trim();

                let i = m.index + m[0].length;
                let depth = 1;
                while (i < code.length && depth > 0) {
                    if (code[i] === '{') depth++;
                    else if (code[i] === '}') depth--;
                    i++;
                }

                // Read the ORIGINAL source for the block, so comments are visible.
                const body = raw.slice(m.index + m[0].length, i - 1);
                // Only the two lines directly above the catch count. A six-line
                // window let an unrelated JSDoc block satisfy the check — the
                // guard passed on a deliberately silent catch when it was first
                // tested, which is the failure mode that matters most in a
                // guard.
                const before = raw.slice(0, m.index).split('\n').slice(-3, -1).join('\n');
                const line = raw.slice(0, m.index).split('\n').length;

                const hasComment = /\/\/|\/\*/.test(body) || /\/\/|\/\*/.test(before);
                const usesBinding = binding
                    && !binding.startsWith('_')
                    && new RegExp(`\\b${binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(body);
                // console.* counts: the release scripts are CLI tools and have no
                // structured logger, so printing the problem is how they report it.
                const logs = /logger\.(error|warn|info)/.test(body) || /console\.(error|warn|log)/.test(body);
                const rethrows = /throw\b/.test(body);

                if (!hasComment && !usesBinding && !logs && !rethrows) {
                    silent.push(`${file}:${line} catch(${binding || 'none'})`);
                }
            }
        }

        return { total, silent };
    }

    test('no error is discarded without logging it or explaining why', () => {
        const { total, silent } = analyse();
        expect(total).toBeGreaterThan(100); // the sweep is actually finding blocks
        expect(silent).toEqual([]);
    });
});
