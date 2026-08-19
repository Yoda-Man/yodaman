/**
 * Read and change the context window Ollama serves.
 *
 * Ollama defaults OLLAMA_CONTEXT_LENGTH by VRAM, and on this class of machine it
 * picks the smallest tier — 4,096 against a model declaring 262,144. The agent's
 * prompt is then trimmed to fit and answers get quietly worse, so the fix is
 * worth offering in the product rather than leaving in a runbook.
 *
 * This writes to a launchd plist and restarts a service, which is more than a
 * local-first tool normally does, so the rules here are deliberately narrow:
 *
 *   - only the known Homebrew plist path is touched, never an arbitrary file
 *   - the value must be one of a bounded set, never free text
 *   - the plist is backed up first and restored if the restart fails
 *   - it is reached by its own endpoint, not through the agent's command tool,
 *     so a model can never trigger it
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('./Logger');

const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', 'homebrew.mxcl.ollama.plist');
const ALLOWED_VALUES = [8192, 16384, 32768, 65536, 131072];
const RECOMMENDED = 32768;

function run(file, args, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve(String(stdout || ''));
        });
    });
}

/** How Ollama is managed here, and what it is currently configured to serve. */
function inspect() {
    const managed = fs.existsSync(PLIST_PATH);
    let configured = Number(process.env.OLLAMA_CONTEXT_LENGTH) || null;

    if (managed && !configured) {
        try {
            const plist = fs.readFileSync(PLIST_PATH, 'utf8');
            const match = /<key>OLLAMA_CONTEXT_LENGTH<\/key>\s*<string>(\d+)<\/string>/.exec(plist);
            if (match) configured = Number(match[1]);
        } catch (err) {
            logger.warn('ollama_plist_unreadable', { path: PLIST_PATH, reason: err.message });
        }
    }

    return { managed, manager: managed ? 'brew' : 'unknown', plistPath: managed ? PLIST_PATH : null, configured, recommended: RECOMMENDED, allowed: ALLOWED_VALUES };
}

/** Insert or replace OLLAMA_CONTEXT_LENGTH inside the plist's EnvironmentVariables. */
function withContextLength(plist, tokens) {
    const entry = `\t\t<key>OLLAMA_CONTEXT_LENGTH</key>\n\t\t<string>${tokens}</string>`;

    if (/<key>OLLAMA_CONTEXT_LENGTH<\/key>\s*<string>\d+<\/string>/.test(plist)) {
        return plist.replace(
            /<key>OLLAMA_CONTEXT_LENGTH<\/key>\s*<string>\d+<\/string>/,
            `<key>OLLAMA_CONTEXT_LENGTH</key>\n\t\t<string>${tokens}</string>`
        );
    }

    if (/<key>EnvironmentVariables<\/key>\s*<dict>/.test(plist)) {
        return plist.replace(
            /(<key>EnvironmentVariables<\/key>\s*<dict>)/,
            `$1\n${entry}`
        );
    }

    // No EnvironmentVariables block yet — add one inside the top-level dict.
    return plist.replace(
        /(<dict>)/,
        `$1\n\t<key>EnvironmentVariables</key>\n\t<dict>\n${entry}\n\t</dict>`
    );
}

/**
 * Set the context length and restart Ollama.
 * Restores the previous plist if the restart fails, so a bad edit cannot leave
 * the user without a model server.
 */
async function setContextLength(tokens) {
    const requested = Number(tokens);
    if (!ALLOWED_VALUES.includes(requested)) {
        const err = new Error(`Context length must be one of: ${ALLOWED_VALUES.join(', ')}`);
        err.status = 400;
        throw err;
    }

    const state = inspect();
    if (!state.managed) {
        const err = new Error(
            'Ollama is not managed by Homebrew here, so YodaMan cannot change it safely. '
            + `Set OLLAMA_CONTEXT_LENGTH=${requested} in the environment Ollama runs under and restart it.`
        );
        err.status = 409;
        throw err;
    }

    const original = fs.readFileSync(PLIST_PATH, 'utf8');
    const backupPath = `${PLIST_PATH}.yodaman-backup`;
    fs.writeFileSync(backupPath, original, 'utf8');

    const updated = withContextLength(original, requested);
    fs.writeFileSync(PLIST_PATH, updated, 'utf8');

    try {
        // plutil rejects a malformed plist before launchd ever sees it.
        await run('plutil', ['-lint', PLIST_PATH], 10000);
        await run('brew', ['services', 'restart', 'ollama'], 60000);
    } catch (err) {
        fs.writeFileSync(PLIST_PATH, original, 'utf8');
        logger.error('ollama_context_change_rolled_back', err, {
            requested,
            path: PLIST_PATH,
            userAction: 'set_ollama_context'
        });
        const failure = new Error(`Could not apply the change, so it was rolled back: ${err.message}`);
        failure.status = 500;
        throw failure;
    }

    logger.info('ollama_context_changed', { requested, path: PLIST_PATH, backupPath });
    return { applied: requested, restarted: true, backupPath };
}

module.exports = { inspect, setContextLength, withContextLength, ALLOWED_VALUES, RECOMMENDED, PLIST_PATH };
