/**
 * External health watchdog.
 *
 * Detection for this product has been manual. In August 2026 a runtime sat at
 * ~96% CPU for seventeen hours, bound to its port, accepting connections and
 * answering none, and nothing noticed — the user did, eventually. This closes
 * that gap.
 *
 * It must be external. That failure blocks the runtime's event loop, so an
 * in-process check is blocked with everything else and reports nothing. The
 * whole point of this file is that it runs somewhere else.
 *
 * The states it distinguishes matter more than the polling:
 *
 *   healthy       responded within the budget
 *   slow          responded, but slower than `--warn-ms`
 *   WEDGED        the port is LISTENING and the request timed out — the exact
 *                 signature of a blocked event loop, and the one that looks
 *                 healthy to every naive check. `lsof` says the process is up,
 *                 `ps` says it is busy, and both are true and useless.
 *   down          nothing is listening; the runtime is simply not running,
 *                 which is a different problem with a different fix
 *
 * Usage:
 *   node scripts/health-watchdog.js              # watch until stopped
 *   node scripts/health-watchdog.js --once       # one probe, exit code is the verdict
 *   node scripts/health-watchdog.js --json       # one line of JSON per probe
 *
 * Exit codes (for cron, launchd, or a monitoring agent):
 *   0 healthy   1 wedged   2 down   3 slow
 */
const { execFileSync } = require('child_process');

const RUNTIME_URL = process.env.YODAMAN_HEALTH_URL || 'http://127.0.0.1:3090';
const PORT = Number(process.env.YODAMAN_PORT || new URL(RUNTIME_URL).port || 3090);
const INTERVAL_MS = Number(process.env.YODAMAN_WATCH_INTERVAL || 30000);
const TIMEOUT_MS = Number(process.env.YODAMAN_WATCH_TIMEOUT || 10000);
const WARN_MS = Number(process.env.YODAMAN_WATCH_WARN || 3000);

const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const JSON_OUT = args.includes('--json');

const EXIT = { healthy: 0, wedged: 1, down: 2, slow: 3 };

/** Is anything holding the port? Distinguishes "wedged" from "not running". */
function portIsListening() {
    try {
        const out = execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return out.trim().length > 0;
    } catch (_err) {
        // lsof exits non-zero when nothing matches, and may be absent entirely.
        return false;
    }
}

async function probe() {
    const started = Date.now();
    try {
        const response = await fetch(`${RUNTIME_URL}/api/health`, {
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        const elapsedMs = Date.now() - started;
        if (!response.ok) {
            return { state: 'slow', elapsedMs, detail: `HTTP ${response.status}` };
        }
        if (elapsedMs > WARN_MS) {
            return { state: 'slow', elapsedMs, detail: `responded in ${elapsedMs}ms` };
        }
        return { state: 'healthy', elapsedMs };
    } catch (err) {
        const elapsedMs = Date.now() - started;
        // The discriminator. Listening but not answering is a blocked loop;
        // nothing listening is a runtime that is not running.
        if (portIsListening()) {
            return {
                state: 'wedged',
                elapsedMs,
                detail: `port ${PORT} is listening but did not answer in ${TIMEOUT_MS}ms`
            };
        }
        return { state: 'down', elapsedMs, detail: err.message };
    }
}

function report(result) {
    const line = { timestamp: new Date().toISOString(), url: RUNTIME_URL, ...result };
    if (JSON_OUT) {
        process.stdout.write(`${JSON.stringify(line)}\n`);
        return;
    }
    const label = result.state.toUpperCase().padEnd(8);
    process.stdout.write(`${line.timestamp}  ${label} ${result.detail || `${result.elapsedMs}ms`}\n`);

    if (result.state === 'wedged') {
        process.stdout.write(
            '          The event loop is blocked. SIGTERM will not work — its handler needs\n'
            + '          the same loop. Capture evidence before restarting:\n'
            + `            sample $(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t | head -1) 5 -f /tmp/yodaman-wedge.txt\n`
            + '          then kill -9. See docs/operations/runbooks.md.\n'
        );
    }
}

async function main() {
    if (ONCE) {
        const result = await probe();
        report(result);
        process.exitCode = EXIT[result.state];
        return;
    }

    process.stdout.write(`Watching ${RUNTIME_URL} every ${INTERVAL_MS / 1000}s. Ctrl-C to stop.\n`);
    let previous = null;
    for (;;) {
        const result = await probe();
        // Only print transitions when healthy, so a quiet runtime stays quiet
        // and a real change is not buried in a wall of "healthy" lines.
        if (result.state !== 'healthy' || previous !== 'healthy') report(result);
        previous = result.state;
        await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }
}

main().catch((err) => {
    process.stderr.write(`Watchdog error: ${err.message}\n`);
    process.exitCode = 2;
});
