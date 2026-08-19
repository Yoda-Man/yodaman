/**
 * Boot the runtime *as packaged* and prove it starts.
 *
 * 0.4.7 was built with every gate green and shipped a desktop app that could not
 * start at all: `Cannot find module '../../shared/pluginInvocation'`. The backend
 * had grown a dependency on shared/, and shared/ was not in electron-builder's
 * file list. Nothing caught it because every other gate — unit tests, plugin and
 * approval journeys, release smoke — runs `node server.js` from the source tree,
 * where shared/ obviously exists.
 *
 * A test of the source is not a test of the artifact. This boots the server.js
 * that is actually inside the .app bundle, on its own port, and waits for
 * /api/health. Any file missing from the package shows up here as the module
 * resolution failure it is.
 *
 * Skips with a clear notice when no package has been built, so it can sit in the
 * release chain without failing a source-only checkout.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RELEASE_DIR = path.resolve(__dirname, '..', 'release');
const PORT = Number(process.env.YODAMAN_PACKAGED_SMOKE_PORT || 3097);
const BOOT_TIMEOUT_MS = 60000;
const log = (msg) => process.stdout.write(`${msg}\n`);

/** server.js inside whichever unpacked bundle this platform produced. */
function packagedServer() {
    const candidates = [
        path.join(RELEASE_DIR, 'mac-arm64', 'YodaMan.app', 'Contents', 'Resources', 'app', 'server.js'),
        path.join(RELEASE_DIR, 'mac', 'YodaMan.app', 'Contents', 'Resources', 'app', 'server.js'),
        path.join(RELEASE_DIR, 'linux-unpacked', 'resources', 'app', 'server.js'),
        path.join(RELEASE_DIR, 'win-unpacked', 'resources', 'app', 'server.js')
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function reachable(url, timeoutMs = 2000) {
    try {
        return (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).ok;
    } catch (_err) {
        // Unreachable is the answer this asks for, not an error to report. The
        // caller decides what an absent runtime means — skip, wait, or fail.
        return false;
    }
}

async function main() {
    const serverPath = packagedServer();
    if (!serverPath) {
        log('SKIP: no packaged app found under release/ — run a desktop build first.');
        return true;
    }

    const appRoot = path.dirname(serverPath);
    log(`Booting the packaged runtime: ${path.relative(RELEASE_DIR, serverPath)}`);

    const child = spawn(process.execPath, [serverPath], {
        cwd: appRoot,
        env: { ...process.env, YODAMAN_PORT: String(PORT) },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });

    const started = Date.now();
    let healthy = false;
    while (Date.now() - started < BOOT_TIMEOUT_MS) {
        if (child.exitCode !== null) break;
        if (await reachable(`http://127.0.0.1:${PORT}/api/health`, 2000)) { healthy = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    child.kill('SIGKILL');

    if (healthy) {
        log('Packaged runtime started and answered /api/health.');
        return true;
    }

    log('\nPACKAGED RUNTIME FAILED TO START — this build is not shippable.\n');
    // A module resolution failure names the file that is missing from the
    // package, which is the whole diagnosis.
    const missing = /Cannot find module '([^']+)'/.exec(output);
    if (missing) {
        log(`  Missing from the package: ${missing[1]}`);
        log('  Add its directory to "files" in electron-builder.json.');
    }
    log(output.split('\n').slice(-25).join('\n'));
    return false;
}

main()
    .then((passed) => { process.exitCode = passed === false ? 1 : 0; })
    .catch((err) => {
        log(`Packaged smoke errored: ${err.message}`);
        process.exitCode = 1;
    });
