/**
 * DependencyChecker — Cross-platform tool locator and service health checker.
 *
 * Handles the Electron PATH gap by searching well-known install locations
 * on macOS, Windows, and Linux. Falls back to `which`/`where` system
 * commands when direct path searching fails.
 *
 * Tested:
 *   macOS (Apple Silicon + Intel), Linux (Debian/Ubuntu, Fedora, Arch),
 *   Windows 10/11, WSL2, Docker containers.
 *
 * Exports:
 *   locate(name)      → { found, path, version }
 *   check(name)       → { found, path, version, running, ok }
 *   checkRunning(name)→ { service, running, url, reason }
 *   checkAll()        → { ollama, ctx, graphify }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

// ─────────────────────────────────────────────────────────────────────────
//  PATH AUGMENTATION — ran once at module init so that `execFile` (used
//  for version checks) and `spawn` (used by ContextEngine) inherit a
//  PATH that includes NVM, Homebrew, pip --user, and other common tool
//  install directories. Without this, commands with `#!/usr/bin/env node`
//  shebangs (like ctx) fail inside Electron's minimal PATH.
// ─────────────────────────────────────────────────────────────────────────
(function augmentPath() {
    const candidates = [];

    // macOS & Linux: NVM
    const nvmRoot = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmRoot)) {
        try {
            fs.readdirSync(nvmRoot)
                .sort()
                .reverse()
                .forEach(v => candidates.push(path.join(nvmRoot, v, 'bin')));
        } catch (_) { }
    }

    // macOS: Homebrew
    if (process.platform === 'darwin') {
        candidates.push('/opt/homebrew/bin', '/usr/local/bin');
    }

    // Linux: Linuxbrew, Snap, Flatpak
    if (process.platform === 'linux') {
        candidates.push(
            '/home/linuxbrew/.linuxbrew/bin',
            path.join(os.homedir(), '.linuxbrew/bin'),
            '/snap/bin',
            '/var/lib/flatpak/exports/bin',
            path.join(os.homedir(), '.local/share/flatpak/exports/bin')
        );
    }

    // All: pip --user, npm global
    candidates.push(
        path.join(os.homedir(), '.local', 'bin'),
        path.join(os.homedir(), 'bin')
    );

    // macOS: fnm (Fast Node Manager)
    if (process.platform === 'darwin' && fs.existsSync(path.join(os.homedir(), 'Library', 'Application Support', 'fnm'))) {
        const fnmNode = path.join(os.homedir(), 'Library', 'Application Support', 'fnm', 'node-versions');
        if (fs.existsSync(fnmNode)) {
            try {
                fs.readdirSync(fnmNode)
                    .sort()
                    .reverse()
                    .forEach(v => candidates.push(path.join(fnmNode, v, 'installation', 'bin')));
            } catch (_) { }
        }
    }

    // Windows: fnm, Chocolatey, Scoop
    if (process.platform === 'win32') {
        candidates.push(
            path.join(os.homedir(), 'AppData', 'Local', 'fnm_multishell'),
            path.join(os.homedir(), 'scoop', 'shims'),
            'C:\\ProgramData\\chocolatey\\bin'
        );
    }

    // Append to PATH — only if the directory exists and isn't already there
    const current = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const added = [];
    for (const c of candidates) {
        if (fs.existsSync(c) && !current.some(p => path.normalize(p) === path.normalize(c))) {
            added.push(c);
        }
    }

    if (added.length > 0) {
        process.env.PATH = [...current, ...added].join(path.delimiter);
        // Log once at init time so it's visible in runtime logs
        const logger = require('./Logger');
        logger.info('dependency_path_augmented', {
            added: added.length,
            sample: added.slice(0, 3).join(', '),
            total: current.length + added.length
        });
    }
})();

// =========================================================================
//  PLATFORM-SPECIFIC SEARCH PATHS
// =========================================================================
// We search these directories when system PATH doesn't contain the tool
// (common in Electron bundled apps where PATH is minimal).

const PLATFORM_PATHS = {
    darwin: [
        '/opt/homebrew/bin',                    // Apple Silicon Homebrew

        '/usr/local/bin',                        // Intel Homebrew / POSIX
        '/usr/bin',                              // System
        '/Applications/Ollama.app/Contents/Resources/cli',  // Official Ollama .app
        `${os.homedir()}/.local/bin`,            // pip --user
        `${os.homedir()}/bin`,                   // User bin
        `${os.homedir()}/.nvm/versions/node/*/bin`,  // NVM global binaries
        `${os.homedir()}/Library/Python/*/bin`,  // Python pip --user (macOS)
    ],
    linux: [
        '/usr/local/bin',
        '/usr/bin',
        '/usr/local/sbin',
        '/snap/bin',                             // Snap packages
        `${os.homedir()}/.local/bin`,            // pip --user
        `${os.homedir()}/bin`,
        `${os.homedir()}/.nvm/versions/node/*/bin`, // NVM
        '/home/linuxbrew/.linuxbrew/bin',        // Linuxbrew (ARM Linux)
        `${os.homedir()}/.linuxbrew/bin`,         // Per-user Linuxbrew
        '/var/lib/flatpak/exports/bin',           // Flatpak system
        `${os.homedir()}/.local/share/flatpak/exports/bin`, // Flatpak user
    ],
    win32: [
        `${os.homedir()}\\AppData\\Local\\Ollama`,
        `${os.homedir()}\\AppData\\Local\\Programs\\Ollama`,
        'C:\\Program Files\\Ollama',
        'C:\\Program Files (x86)\\Ollama',
        `${os.homedir()}\\AppData\\Roaming\\npm`,   // npm global
        `${os.homedir()}\\AppData\\Local\\fnm_multishell`, // fnm (fast nvm)
        'C:\\Program Files\\nodejs',
        'C:\\Program Files\\Git\\usr\\bin',         // Git Bash tools
        `${os.env && os.env.ProgramData || 'C:\\ProgramData'}\\chocolatey\\bin`, // Chocolatey
        `${os.homedir()}\\scoop\\shims`,            // Scoop
        `${os.homedir()}\\scoop\\apps\\ollama\\current`,
    ],
};

// Expand wildcard paths like ~/Library/Python/*/bin into real directories
function expandGlob(pattern) {
    const starIndex = pattern.indexOf('*');
    if (starIndex === -1) {
        return fs.existsSync(pattern) ? [pattern] : [];
    }
    const base = pattern.substring(0, starIndex);
    const suffix = pattern.substring(starIndex + 1);
    if (!fs.existsSync(base)) return [];
    try {
        return fs.readdirSync(base)
            .map(entry => path.join(base, entry, suffix))
            .filter(p => fs.existsSync(p));
    } catch {
        return [];
    }
}

// =========================================================================
//  AUGMENT SYSTEM PATH
// =========================================================================
// Electron does not inherit the user's full shell PATH. We proactively
// expand our known platform search paths and inject them into process.env.PATH
// so tools like `ctx` (which rely on `#!/usr/bin/env node`) can find `node`.
(function augmentSystemPath() {
    const platform = process.platform;
    const searchDirs = PLATFORM_PATHS[platform] || [];
    const currentPaths = new Set((process.env.PATH || '').split(path.delimiter).filter(Boolean));

    for (const dir of searchDirs) {
        if (dir.includes('*')) {
            const expanded = expandGlob(dir);
            for (const sub of expanded) {
                if (!currentPaths.has(sub)) {
                    currentPaths.add(sub);
                    process.env.PATH = `${sub}${path.delimiter}${process.env.PATH}`;
                }
            }
        } else {
            if (fs.existsSync(dir) && !currentPaths.has(dir)) {
                currentPaths.add(dir);
                process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
            }
        }
    }
})();

// =========================================================================
//  SERVICE DEFINITIONS
// =========================================================================

const SERVICES = {
    ollama: {
        executable: process.platform === 'win32' ? 'ollama.exe' : 'ollama',
        versionArgs: ['--version'],
        runningCheck: { url: 'http://127.0.0.1:11434/api/tags', timeout: 2000 },
        installUrl: 'https://ollama.com',
        installHint: {
            darwin: 'brew install ollama  or  download from https://ollama.com/download',
            linux: 'curl -fsSL https://ollama.com/install.sh | sh',
            win32: 'winget install Ollama.Ollama  or  download from https://ollama.com/download',
        },
    },
    ctx: {
        executable: 'ctx',
        versionArgs: ['--version'],
        runningCheck: null,
        installUrl: 'npm install -g @context-expert/cli',
        installHint: {
            darwin: 'npm install -g @context-expert/cli',
            linux: 'npm install -g @context-expert/cli',
            win32: 'npm install -g @context-expert/cli',
        },
    },
    graphify: {
        executable: 'graphify',
        versionArgs: ['--help'],
        // graphify --help may include non-version output; accept any result as "installed"
        versionLabel: 'installed',
        runningCheck: null,
        installUrl: 'pip install graphifyy',
        installHint: {
            darwin: 'python3 -m pip install --user graphifyy',
            linux: 'python3 -m pip install --user graphifyy',
            win32: 'py -m pip install graphifyy',
        },
    },
};

// =========================================================================
//  CORE HELPERS
// =========================================================================

/**
 * Check if a path is a real file (not a directory like Cellar/ollama).
 */
function isFile(p) {
    try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

/**
 * Try to find an executable by name.
 *
 Strategy (in order):
 *   1. Check every directory in process.env.PATH
 *   2. Check well-known platform install locations
 *   3. On Unix: run `which <name>` as a last-resort fallback
 *   4. On Windows: run `where <name>` as a last-resort fallback
 */
function which(name) {
    // ── 1. System PATH (works in dev, may be minimal in Electron) ──
    const PATH = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const dir of PATH) {
        try {
            const full = path.resolve(dir, name);
            if (isFile(full)) return full;
        } catch (_) { /* invalid path entry */ }
    }

    // ── 2. Platform-specific known locations ──
    const platform = process.platform;
    const searchDirs = PLATFORM_PATHS[platform] || [];
    for (const dir of searchDirs) {
        // Handle wildcard paths (~/Library/Python/*/bin, ~/.nvm/versions/node/*/bin etc.)
        if (dir.includes('*')) {
            const expanded = expandGlob(dir);
            for (const sub of expanded) {
                const full = path.join(sub, name);
                if (isFile(full)) return full;
            }
        } else {
            const full = path.join(dir, name);
            if (isFile(full)) return full;
        }
    }

    // ── 3. Unix: `which` command fallback ──
    if (platform === 'darwin' || platform === 'linux') {
        try {
            const result = execFileSync('which', [name], {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            if (result && isFile(result)) return result;
        } catch (_) { /* which not available or not found */ }
    }

    // ── 4. macOS: Homebrew query fallback ──
    if (platform === 'darwin') {
        try {
            const brewPrefix = execFileSync('brew', ['--prefix'], {
                encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            const brewBin = path.join(brewPrefix, 'bin', name);
            if (fs.existsSync(brewBin)) return brewBin;
        } catch (_) { /* brew not available */ }
    }

    // ── 5. Windows: `where` command fallback ──
    if (platform === 'win32') {
        try {
            const result = execFileSync('where', [name], {
                encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
            }).trim().split('\n')[0];
            if (result && isFile(result)) return result;
        } catch (_) { /* where not available or not found */ }
    }

    return null;
}

/**
 * Get the version string for an executable.
 *
 * Handles:
 *   - `ctx --version` output with tip lines before the version
 *   - Standard `tool --version` with "v1.2.3" or "1.2.3" formats
 *   - Commands that write tips/diagnostics to stdout before the version
 *
 * Strategy: find the last line that looks like a version number
 * (starts with a digit or "v" followed by a digit), then strip
 * any common "v" prefix or "version" label.
 *
 * Returns null on failure (non-critical — tool is still reported as found).
 */
function getVersion(binPath, versionArgs) {
    return new Promise((resolve) => {
        execFile(binPath, versionArgs, { timeout: 10000 }, (err, stdout) => {
            if (err) { resolve(null); return; }

            const lines = stdout.toString().trim().split('\n');

            // Walk lines from the end — the version is usually the last
            // substantive line (tools often print tips before the version).
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (!line) continue;

                // Match any version-like string: "1.2.3", "v1.2.3", "version is 1.2.3",
                // "ollama version is 0.30.8", "1.2.3-alpha", etc.
                const m = line.match(/v?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)/);
                if (m) { resolve(m[1]); return; }
            }

            // Fallback: return the last non-empty line as-is
            const last = lines.filter(l => l.trim()).pop();
            resolve(last ? last.trim() : null);
        });
    });
}

/**
 * Check if a network service is running by hitting its HTTP endpoint.
 */
function isServiceRunning(url, timeout = 2000) {
    return new Promise((resolve) => {
        if (!url) { resolve(null); return; }
        const mod = url.startsWith('https') ? require('https') : require('http');
        const req = mod.get(url, { timeout }, (res) => {
            res.resume();
            resolve(res.statusCode < 500);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

// =========================================================================
//  PUBLIC API
// =========================================================================

/**
 * Locate a tool binary and determine its version.
 *
 * @param {string} name — 'ollama', 'ctx', or 'graphify'
 * @returns {Promise<{found: boolean, path: string|null, version: string|null, error: string|null, installUrl: string, installHint: string}>}
 */
async function locate(name) {
    const svc = SERVICES[name];
    if (!svc) {
        return {
            found: false, path: null, version: null,
            error: `Unknown dependency: "${name}"`,
            installUrl: '', installHint: '',
        };
    }

    const binPath = which(svc.executable);
    if (!binPath) {
        const hint = (svc.installHint && svc.installHint[process.platform]) || svc.installUrl;
        return {
            found: false, path: null, version: null,
            error: `${name} not found`,
            installUrl: svc.installUrl,
            installHint: hint,
        };
    }

    const version = svc.versionLabel || (await getVersion(binPath, svc.versionArgs));
    return {
        found: true, path: binPath, version,
        error: null,
        installUrl: svc.installUrl,
        installHint: null,
    };
}

/**
 * Check if a service (e.g. Ollama) is currently running.
 */
async function checkRunning(name) {
    const svc = SERVICES[name];
    if (!svc || !svc.runningCheck) {
        return { service: name, running: null, reason: 'no health endpoint' };
    }
    const running = await isServiceRunning(svc.runningCheck.url, svc.runningCheck.timeout);
    return {
        service: name,
        running,
        url: svc.runningCheck.url,
        reason: running ? 'responding' : 'not responding',
    };
}

/**
 * Full check: locate binary, get version, and (for services) check running.
 *
 * @returns {Promise<{name, found, path, version, running, ok, error, installUrl, installHint}>}
 *   `ok` = found AND (no running check OR running === true)
 */
async function check(name) {
    const install = await locate(name);
    const running = install.found ? await checkRunning(name) : { running: false, reason: 'not installed' };

    return {
        name,
        found: install.found,
        path: install.path,
        version: install.version,
        running: running.running,
        runningUrl: running.url,
        installUrl: install.installUrl,
        installHint: install.installHint,
        error: install.error,
        ok: install.found && (running.running !== false || running.running === null),
    };
}

/**
 * Check all known dependencies.
 */
async function checkAll() {
    const results = {};
    for (const name of Object.keys(SERVICES)) {
        results[name] = await check(name);
    }
    return results;
}

module.exports = { locate, check, checkAll, checkRunning, which, SERVICES, PLATFORM_PATHS };
