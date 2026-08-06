/**
 * OriginPolicy (Infrastructure Layer)
 *
 * Cross-site request policy for the local runtime.
 *
 * WHY THIS EXISTS
 * ---------------
 * The runtime used to trust any request whose TCP source address was loopback
 * ("isLocalRequest"). That is not a trust boundary. A browser executing a
 * malicious page's JavaScript on the user's machine *is* 127.0.0.1, so any
 * website the user visited could call the API — including PUT /settings, which
 * flips allowAgentCommands and unlocks shell execution. Paired with
 * `app.use(cors())` (Access-Control-Allow-Origin: *) the attacker could read the
 * responses too.
 *
 * The source IP cannot distinguish "the user's own UI" from "a web page the user
 * happens to have open". The `Origin` and `Sec-Fetch-Site` headers can, because
 * they are set by the browser and cannot be forged by page script.
 *
 * POLICY
 * ------
 *   1. Origin present and not local  -> reject. Blocks every cross-site fetch,
 *      XHR, and form POST from a remote page.
 *   2. Sec-Fetch-Site: cross-site    -> reject. Belt-and-braces for browsers
 *      that omit Origin on some navigations.
 *   3. Neither header present        -> not a browser (curl, the CLI, the native
 *      mobile client). Fall through to the pairing-token / loopback checks.
 *
 * A local *process* is deliberately still trusted: it already runs with the
 * user's privileges, so gating it would add no security. The threat being closed
 * is the remote *page*, not the local process.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * True if `origin` is a loopback web origin (any port).
 * Accepts http/https on localhost, 127.0.0.1, and ::1 — this covers the built
 * UI on the runtime port, the Vite dev server on 5190, and the Electron shell.
 * @param {string} origin - Value of the Origin header.
 */
function isLocalOrigin(origin) {
    if (!origin || typeof origin !== 'string') return false;
    // "null" is what a sandboxed iframe or a file:// page sends. Never trust it.
    if (origin === 'null') return false;

    let parsed;
    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return LOCAL_HOSTNAMES.has(parsed.hostname);
}

/**
 * Express CORS `origin` callback. Reflects loopback origins only — never '*'.
 * Requests without an Origin (curl, native clients) are allowed through here;
 * they are still subject to the pairing-token check downstream.
 */
function corsOrigin(origin, callback) {
    if (!origin || isLocalOrigin(origin)) return callback(null, true);
    return callback(null, false);
}

/**
 * Rejects browser-initiated cross-site requests before they reach any handler.
 * Mount this ahead of the pairing middleware.
 */
function crossSiteGuard(req, res, next) {
    const origin = req.get('Origin');
    if (origin && !isLocalOrigin(origin)) {
        return res.status(403).json({
            error: 'Cross-site requests are not permitted',
            code: 'cross_site_blocked'
        });
    }

    if (req.get('Sec-Fetch-Site') === 'cross-site') {
        return res.status(403).json({
            error: 'Cross-site requests are not permitted',
            code: 'cross_site_blocked'
        });
    }

    return next();
}

module.exports = { isLocalOrigin, corsOrigin, crossSiteGuard, LOCAL_HOSTNAMES };
