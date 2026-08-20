const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const logger = require('./Logger');
const { IGNORED_DIRECTORIES } = require('../../shared/ignoredPaths');
const dependencyChecker = require('./DependencyChecker');

const DEFAULT_TIMEOUT_MS = Number(process.env.YODAMAN_GRAPHIFY_TIMEOUT_MS || 300000);
const DEFAULT_OLLAMA_MODEL = process.env.YODAMAN_GRAPHIFY_OLLAMA_MODEL || 'qwen3:5b';
const DEFAULT_VIZ_NODE_LIMIT = process.env.YODAMAN_GRAPHIFY_VIZ_NODE_LIMIT || '25000';
const STALE_RUNNING_BUILD_MS = Number(process.env.YODAMAN_GRAPHIFY_RUNNING_STALE_MS || 30 * 60 * 1000);
const CLOUD_MODEL_KEYS = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'DEEPSEEK_API_KEY',
    'MOONSHOT_API_KEY'
];
const ARTIFACTS = {
    mindmap: 'graph.html',
    visualizer: 'graph_visualizer.html'
};
const REPORT_FILENAMES = ['graph_report.md', 'GRAPH_REPORT.md'];
const BUILD_STATUS_FILENAME = 'yodaman-build-status.json';
let resolvedGraphifyBin = null;

function findUserGraphifyBins() {
    const pythonRoot = path.join(os.homedir(), 'Library', 'Python');
    if (!fs.existsSync(pythonRoot)) return [];
    return fs.readdirSync(pythonRoot)
        .map(version => path.join(pythonRoot, version, 'bin', 'graphify'))
        .filter(candidate => fs.existsSync(candidate));
}

function getGraphifyBin() {
    if (resolvedGraphifyBin) return resolvedGraphifyBin;

    // 1. Environment variable override
    if (process.env.YODAMAN_GRAPHIFY_BIN) {
        resolvedGraphifyBin = process.env.YODAMAN_GRAPHIFY_BIN;
        return resolvedGraphifyBin;
    }

    // 2. DependencyChecker cross-platform search (handles any OS, any package manager)
    const found = dependencyChecker.which('graphify');
    if (found) {
        resolvedGraphifyBin = found;
        return resolvedGraphifyBin;
    }

    // 3. macOS Python user-install paths (legacy)
    const userBins = findUserGraphifyBins();
    if (userBins.length > 0) {
        resolvedGraphifyBin = userBins[0];
        return resolvedGraphifyBin;
    }

    // 4. Last resort — rely on system PATH (may fail in Electron)
    resolvedGraphifyBin = 'graphify';
    return resolvedGraphifyBin;
}

function runGraphify(args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const env = graphifyEnvironment();

    return new Promise((resolve, reject) => {
        execFile(getGraphifyBin(), args, {
            env,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024 * 5
        }, (err, stdout, stderr) => {
            if (err) {
                const detail = stderr?.trim() || stdout?.trim() || err.message;
                const error = new Error(detail);
                error.cause = err;
                reject(error);
                return;
            }

            resolve({
                stdout: stdout.trim(),
                stderr: stderr.trim()
            });
        });
    });
}

function graphifyEnvironment() {
    const env = { ...process.env };
    CLOUD_MODEL_KEYS.forEach(key => {
        delete env[key];
    });
    if (!env.GRAPHIFY_VIZ_NODE_LIMIT) {
        env.GRAPHIFY_VIZ_NODE_LIMIT = DEFAULT_VIZ_NODE_LIMIT;
    }

    return env;
}

function graphPath(projectPath) {
    return path.join(projectPath, 'graphify-out', 'graph.json');
}

function graphifyOutPath(projectPath) {
    return path.join(projectPath, 'graphify-out');
}

function artifactPath(projectPath, type) {
    const filename = ARTIFACTS[type];
    if (!filename) {
        const err = new Error(`Unknown Graphify artifact type: ${type}`);
        err.status = 400;
        err.code = 'invalid_graphify_artifact';
        throw err;
    }
    return path.join(graphifyOutPath(projectPath), filename);
}

function artifactMissingError(currentArtifactPath) {
    const err = new Error(`Graphify artifact not found: ${currentArtifactPath}`);
    err.status = 404;
    err.code = 'graphify_artifact_missing';
    return err;
}

function safeFilePath(filePath, baseDir) {
    let baseStat;
    try {
        baseStat = fs.lstatSync(baseDir);
    } catch (_err) {
        // A base directory that cannot be stat'd is not an error to report — it is
        // the answer. This is a containment check, and "the path is not there"
        // and "the path is not allowed" both mean refuse.
        return '';
    }

    if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
        return '';
    }

    let stat;
    try {
        stat = fs.lstatSync(filePath);
    } catch (_err) {
        // Same as the base-directory check above: absent is a refusal, not a fault.
        return '';
    }

    if (stat.isSymbolicLink() || !stat.isFile()) {
        return '';
    }

    try {
        const realBaseDir = fs.realpathSync(baseDir);
        const realFilePath = fs.realpathSync(filePath);
        const relativeFilePath = path.relative(realBaseDir, realFilePath);
        if (relativeFilePath.startsWith('..') || path.isAbsolute(relativeFilePath)) {
            return '';
        }
        return filePath;
    } catch (_err) {
        // Containment check: anything that cannot be resolved is refused. Empty is
        // the refusal, and it must not depend on why resolution failed.
        return '';
    }
}

function existingReportPath(projectPath) {
    const outDir = graphifyOutPath(projectPath);
    const found = REPORT_FILENAMES
        .map(filename => path.join(outDir, filename))
        .find(candidate => safeFilePath(candidate, outDir));
    return found || path.join(outDir, REPORT_FILENAMES[0]);
}

function reportPath(projectPath) {
    return existingReportPath(projectPath);
}

function buildStatusPath(projectPath) {
    return path.join(graphifyOutPath(projectPath), BUILD_STATUS_FILENAME);
}

function hasGraph(projectPath) {
    return fs.existsSync(graphPath(projectPath));
}

// Symlinked directories are NEVER followed here, and the depth is capped.
// Both guards are load-bearing: Flutter writes .plugin_symlinks/ and .symlinks/
// entries that point back into an ancestor directory, and statSync() resolves a
// link to its target, so isDirectory() was true and the walk recursed forever.
// That wedged the whole runtime — this walk is synchronous, so a cycle blocks
// the event loop, and the process kept the port bound at 100% CPU while every
// request hung. GET /api/readiness reaches this on the Electron startup poll.
const MAX_SOURCE_SCAN_DEPTH = 12;

// The scan is synchronous, so its cost is charged to the event loop: every
// GET /api/readiness walked all watched trees before answering (~300ms across
// seven projects here), and the desktop dashboard polls that route. Cache per
// project for long enough to absorb a poll burst, but briefly enough that an
// edit shows up as stale almost immediately.
const SOURCE_MTIME_TTL_MS = 10 * 1000;
const sourceMtimeCache = new Map();

/** Drop cached scan results. Exposed for tests and post-write invalidation. */
function resetSourceMtimeCache(projectPath) {
    if (projectPath) sourceMtimeCache.delete(projectPath);
    else sourceMtimeCache.clear();
}

function latestSourceMtime(projectPath) {
    const cached = sourceMtimeCache.get(projectPath);
    if (cached && (Date.now() - cached.at) < SOURCE_MTIME_TTL_MS) return cached.value;
    const value = scanSourceMtime(projectPath);
    sourceMtimeCache.set(projectPath, { value, at: Date.now() });
    return value;
}

function scanSourceMtime(projectPath) {
    // Shared with the watcher and the indexer. Scanning our own generated
    // output here is not just slow: a newer chunk file reads as "the source
    // changed", so the graph looks stale on work nothing did to the source.
    const ignored = new Set(IGNORED_DIRECTORIES);
    let latest = 0;

    function walk(dir, depth) {
        if (depth > MAX_SOURCE_SCAN_DEPTH) return;

        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_err) {
            // One unreadable directory must not abort a whole-workspace scan. A
            // permission-denied subfolder is normal; reporting it per directory
            // would bury the log on every scan of a real machine.
            return;
        }

        for (const entry of entries) {
            // isSymbolicLink() comes off the dirent, so it describes the link
            // itself. Do not swap this for a statSync() check — that follows the
            // link and reports the target, which is exactly the bug above.
            if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
            const entryPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                walk(entryPath, depth + 1);
                continue;
            }
            if (!entry.isFile()) continue;

            let stat;
            try {
                stat = fs.statSync(entryPath);
            } catch (_err) {
                // A dangling symlink or a file removed mid-walk. Skip the entry; the
                // freshness scan only needs the newest mtime it can see.
                continue;
            }
            latest = Math.max(latest, stat.mtimeMs);
        }
    }

    if (fs.existsSync(projectPath)) walk(projectPath, 0);
    return latest;
}

function truncate(text, max = 6000) {
    if (!text || text.length <= max) return text || '';
    return `${text.slice(0, max)}\n[Graphify output truncated to ${max} characters]`;
}

function parseBuildOutput(output = '') {
    const rebuiltMatch = output.match(/Rebuilt:\s*([\d,]+)\s+nodes,\s*([\d,]+)\s+edges/i);
    const skippedVizMatch = output.match(/Skipped graph\.html:\s*(.+)/i);
    const nodeCount = rebuiltMatch ? Number(rebuiltMatch[1].replace(/,/g, '')) : undefined;
    const edgeCount = rebuiltMatch ? Number(rebuiltMatch[2].replace(/,/g, '')) : undefined;
    const skippedReason = skippedVizMatch ? skippedVizMatch[1].trim() : undefined;
    return { nodeCount, edgeCount, skippedReason };
}

function needsArtifactRegeneration({ output = '', missingArtifacts = [], graphExists = false } = {}) {
    return graphExists
        && missingArtifacts.length > 0
        && /outputs left untouched/i.test(output);
}

function artifactMetadata(projectPath, type, buildStatus = {}) {
    const currentArtifactPath = artifactPath(projectPath, type);
    const exists = Boolean(safeFilePath(currentArtifactPath, graphifyOutPath(projectPath)));
    const stat = exists ? fs.statSync(currentArtifactPath) : null;
    const skippedReason = buildStatus.skippedArtifacts?.[type];
    return {
        path: currentArtifactPath,
        exists,
        updatedAt: stat?.mtime?.toISOString(),
        skippedReason
    };
}

function isStaleRunningBuild(buildStatus, now = new Date()) {
    if (buildStatus.state !== 'running') return false;
    const timestamp = Date.parse(buildStatus.updatedAt || buildStatus.startedAt || '');
    if (!Number.isFinite(timestamp)) return false;
    return now.getTime() - timestamp > STALE_RUNNING_BUILD_MS;
}

function summarizeBuildStatus(projectPath, buildStatus, { now = new Date() } = {}) {
    const currentGraphPath = graphPath(projectPath);
    const graphExists = fs.existsSync(currentGraphPath);
    const artifacts = Object.fromEntries(Object.keys(ARTIFACTS).map(type => [
        type,
        artifactMetadata(projectPath, type, buildStatus)
    ]));
    const hasAnyArtifact = Object.values(artifacts).some(artifact => artifact.exists);
    const skippedArtifacts = { ...(buildStatus.skippedArtifacts || {}) };

    if (isStaleRunningBuild(buildStatus, now)) {
        if (graphExists && hasAnyArtifact) {
            return {
                ...buildStatus,
                state: 'succeeded',
                message: 'Previous Graphify build status was stale; using last generated graph visualization.',
                staleRunning: true
            };
        }

        if (graphExists) {
            Object.keys(ARTIFACTS).forEach(type => {
                if (!skippedArtifacts[type]) skippedArtifacts[type] = 'Previous Graphify build status was stale and full HTML visualization is unavailable.';
            });
            return {
                ...buildStatus,
                state: 'partial',
                message: 'Previous Graphify build status was stale; graph exists but full HTML visualization is unavailable.',
                skippedArtifacts,
                staleRunning: true
            };
        }

        return {
            ...buildStatus,
            state: 'idle',
            message: 'Previous Graphify build status was stale and no generated graph was found.',
            staleRunning: true
        };
    }

    if (graphExists && !hasAnyArtifact && buildStatus.state !== 'running' && buildStatus.state !== 'failed') {
        const reason = buildStatus.message?.includes('too large')
            ? buildStatus.message
            : 'Full HTML visualization unavailable for this graph. Use Map Preview or Report.';
        const message = buildStatus.message?.includes('too large')
            ? buildStatus.message
            : 'Graph built, but full HTML visualization is unavailable.';
        Object.keys(ARTIFACTS).forEach(type => {
            if (!skippedArtifacts[type]) skippedArtifacts[type] = reason;
        });
        return {
            ...buildStatus,
            state: 'partial',
            message,
            skippedArtifacts
        };
    }

    return buildStatus;
}

function extractJsonArray(html, variableName) {
    const marker = `const ${variableName} = `;
    const start = html.indexOf(marker);
    if (start === -1) return null;
    const arrayStart = html.indexOf('[', start + marker.length);
    if (arrayStart === -1) return null;

    let depth = 0;
    let inString = false;
    let quote = '';
    let escaped = false;
    for (let index = arrayStart; index < html.length; index += 1) {
        const char = html[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                inString = false;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            inString = true;
            quote = char;
            continue;
        }
        if (char === '[') depth += 1;
        if (char === ']') {
            depth -= 1;
            if (depth === 0) {
                return {
                    json: html.slice(arrayStart, index + 1),
                    start: arrayStart,
                    end: index + 1
                };
            }
        }
    }
    return null;
}

function sourceLabelForCommunity(nodes) {
    const counts = new Map();
    nodes.forEach(node => {
        const source = node.source_file || node.sourceFile || '';
        if (!source) return;
        const basename = path.basename(source);
        const dir = path.basename(path.dirname(source));
        const label = basename && basename !== '.' ? basename : dir;
        if (!label) return;
        counts.set(label, (counts.get(label) || 0) + 1);
    });

    const [label] = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || [];
    return label ? `${label} cluster` : '';
}

/**
 * CDN script tags that must be served locally instead.
 * Keep in sync with scripts/sync-vendor.js.
 */
const VENDOR_SCRIPT_REWRITES = [
    {
        // Graphify hardcodes this tag in every graph artifact it emits.
        pattern: /https?:\/\/unpkg\.com\/vis-network@[\d.]+\/standalone\/umd\/vis-network\.min\.js/g,
        local: '/vendor/vis-network.min.js',
        name: 'vis-network'
    }
];


/**
 * Remove the subresource-integrity attributes from a script we have just
 * repointed at a local copy.
 *
 * Graphify emits its CDN tag with an `integrity` hash computed for the file on
 * unpkg. Rewriting `src` to our vendored copy left that hash in place, and the
 * vendored copy is a DIFFERENT BUILD — vis-network was upgraded from 9.x to
 * 10.1.1 to clear a vulnerability, so the hashes cannot match by construction.
 * The browser did exactly what it was told and blocked the script, `vis` was
 * never defined, and Graph Studio rendered an empty canvas while reporting the
 * graph as ready. The data was fine; nothing could draw it.
 *
 * SRI exists to detect a CDN serving something other than what was asked for.
 * A same-origin file we ship and audit ourselves is not that threat, and a hash
 * that can never match is not security — it is an outage.
 */
function stripStaleIntegrity(html, localSrc) {
    const escaped = localSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const scriptTag = new RegExp(`<script\\b[^>]*src=["']${escaped}["'][^>]*>`, 'gi');
    return html.replace(scriptTag, (tag) => tag
        .replace(/\s+integrity=(["'])[^"']*\1/gi, '')
        .replace(/\s+crossorigin=(["'])[^"']*\1/gi, ''));
}

/**
 * Points a Graphify artifact's external <script> tags at locally served copies.
 *
 * Graphify emits `<script src="https://unpkg.com/vis-network@9.1.6/...">`. Two
 * problems with shipping that as-is: a local-first product should not need the
 * public internet to draw a graph, and it forced the artifact's CSP to allow an
 * external origin plus 'unsafe-eval'. The asset is vendored into public/vendor/
 * by scripts/sync-vendor.js, so the tag can point at our own origin.
 *
 * This is deliberately a narrow rewrite of a known URL, not a general HTML
 * transform — the input is third-party output we do not control. If Graphify
 * changes its markup the pattern stops matching, which is logged rather than
 * silently ignored, because the CSP will then block the CDN and the graph will
 * render blank.
 *
 * @param {string} html - Raw artifact HTML as written by Graphify.
 * @returns {string} HTML with vendor scripts pointed at local copies.
 */
function localizeVendorScripts(html) {
    if (!html) return html;

    let result = html;
    for (const rewrite of VENDOR_SCRIPT_REWRITES) {
        const matches = result.match(rewrite.pattern);
        if (matches) {
            result = result.replace(rewrite.pattern, rewrite.local);
            result = stripStaleIntegrity(result, rewrite.local);
            continue;
        }
        // Only worth reporting if the artifact still points somewhere remote.
        if (/<script[^>]+src=["']https?:\/\//i.test(result)) {
            logger.warn('graphify_artifact_vendor_rewrite_missed', {
                vendor: rewrite.name,
                detail: 'Artifact loads a remote script this rewrite did not match. The CSP will block it. Graphify output format may have changed.'
            });
        }
    }
    return result;
}

function enhanceArtifactHtml(html) {
    if (!html || !html.includes('Community ')) return html;

    const nodesBlock = extractJsonArray(html, 'RAW_NODES');
    const legendBlock = extractJsonArray(html, 'LEGEND');
    if (!nodesBlock || !legendBlock) return html;

    let nodes;
    let legend;
    try {
        nodes = JSON.parse(nodesBlock.json);
        legend = JSON.parse(legendBlock.json);
    } catch {
        // Enhancement is optional: if Graphify's embedded JSON is not shaped the
        // way this expects, return the artifact untouched. A viewable graph
        // without our additions beats a failed request.
        return html;
    }

    const nodesByCommunity = new Map();
    nodes.forEach(node => {
        const community = node.community;
        if (community === undefined || community === null) return;
        const key = String(community);
        if (!nodesByCommunity.has(key)) nodesByCommunity.set(key, []);
        nodesByCommunity.get(key).push(node);
    });

    const labelsByCommunity = new Map();
    legend.forEach(item => {
        const current = String(item.label || '');
        if (!/^Community\s+\d+$/i.test(current)) return;
        const label = sourceLabelForCommunity(nodesByCommunity.get(String(item.cid)) || []);
        if (label) {
            item.label = label;
            labelsByCommunity.set(String(item.cid), label);
        }
    });

    if (labelsByCommunity.size === 0) return html;

    nodes.forEach(node => {
        const label = labelsByCommunity.get(String(node.community));
        if (label && /^Community\s+\d+$/i.test(String(node.community_name || ''))) {
            node.community_name = label;
        }
    });

    let nextHtml = html;
    nextHtml = `${nextHtml.slice(0, legendBlock.start)}${JSON.stringify(legend)}${nextHtml.slice(legendBlock.end)}`;
    const adjustedNodesBlock = extractJsonArray(nextHtml, 'RAW_NODES');
    if (adjustedNodesBlock) {
        nextHtml = `${nextHtml.slice(0, adjustedNodesBlock.start)}${JSON.stringify(nodes)}${nextHtml.slice(adjustedNodesBlock.end)}`;
    }
    return nextHtml;
}

module.exports = {
    resetSourceMtimeCache,
    // Exported so the render gate can drive the real localiser rather than a
    // copy of it — a test of a reimplementation proves nothing about shipping code.
    localizeVendorScripts,
    // Set to true after assertAvailable() confirms Ollama is installed.
    _ollamaAvailable: false,
    graphPath,
    reportPath,
    buildStatusPath,
    artifactPath,
    graphifyEnvironment,
    needsArtifactRegeneration,
    enhanceArtifactHtml,
    hasGraph,
    getGraphifyBin,

    async assertAvailable() {
        try {
            await runGraphify(['--help'], { timeoutMs: 10000 });
            logger.info('graphify_available', { binary: getGraphifyBin() });
        } catch (err) {
            logger.error('graphify_unavailable', err, { binary: getGraphifyBin() });
            throw new Error(
                `Graphify is required but "${getGraphifyBin()}" is not available. Install it with "pip install graphifyy" and ensure the "graphify" command is in PATH, or set YODAMAN_GRAPHIFY_BIN.`,
                { cause: err }
            );
        }

        // Ollama is optional — only needed for full-semantic extraction.
        // Uses DependencyChecker which searches common install paths
        // even when Electron's bundled PATH doesn't include them.
        try {
            const ollamaCheck = await dependencyChecker.check('ollama');
            this._ollamaAvailable = ollamaCheck.found && ollamaCheck.running;
            if (ollamaCheck.found) {
                logger.info('ollama_available', {
                    path: ollamaCheck.path,
                    version: ollamaCheck.version,
                    running: ollamaCheck.running
                });
                if (!ollamaCheck.running) {
                    logger.warn('ollama_not_running', {
                        message: `Ollama found at ${ollamaCheck.path} but is not running. Start it with \`ollama serve\` or launch the Ollama app.`
                    });
                }
            } else {
                logger.warn('ollama_unavailable', {
                    message: ollamaCheck.error + ' Graphify full-semantic extraction will be disabled.',
                    binary: 'ollama'
                });
            }
        } catch (err) {
            logger.warn('ollama_check_error', { message: err.message });
            this._ollamaAvailable = false;
        }
    },

    async build(projectPath, { update = false } = {}) {
        const args = process.env.YODAMAN_GRAPHIFY_FULL_EXTRACT === 'true'
            ? ['extract', projectPath, '--backend', 'ollama', '--model', DEFAULT_OLLAMA_MODEL, '--out', projectPath]
            : ['update', projectPath, '--force'];

        logger.info('graphify_build_started', { path: projectPath, update });
        const startedAt = new Date();
        this.writeBuildStatus(projectPath, {
            state: 'running',
            message: 'Graphify build running',
            startedAt: startedAt.toISOString()
        });
        try {
            const result = await runGraphify(args);
            let output = result.stdout || result.stderr;
            const parsed = parseBuildOutput(output);
            let artifacts = Object.fromEntries(Object.keys(ARTIFACTS).map(type => [type, artifactMetadata(projectPath, type)]));
            let missingArtifacts = Object.entries(artifacts).filter(([, artifact]) => !artifact.exists).map(([type]) => type);
            if (needsArtifactRegeneration({
                output,
                missingArtifacts,
                graphExists: fs.existsSync(graphPath(projectPath))
            })) {
                const regenResult = await runGraphify(['cluster-only', projectPath]);
                output = `${output}\n${regenResult.stdout || regenResult.stderr}`.trim();
                artifacts = Object.fromEntries(Object.keys(ARTIFACTS).map(type => [type, artifactMetadata(projectPath, type)]));
                missingArtifacts = Object.entries(artifacts).filter(([, artifact]) => !artifact.exists).map(([type]) => type);
            }
            const skippedArtifacts = {};
            if (parsed.skippedReason) {
                missingArtifacts.forEach(type => {
                    skippedArtifacts[type] = parsed.skippedReason;
                });
            }
            const state = missingArtifacts.length > 0 && fs.existsSync(graphPath(projectPath)) ? 'partial' : 'succeeded';
            const completedAt = new Date();
            const buildStatus = this.writeBuildStatus(projectPath, {
                state,
                message: state === 'partial'
                    ? 'Graphify graph built with skipped visualizations'
                    : 'Graphify graph built successfully',
                startedAt: startedAt.toISOString(),
                completedAt: completedAt.toISOString(),
                durationMs: completedAt.getTime() - startedAt.getTime(),
                output: truncate(output, 4000),
                skippedArtifacts,
                nodeCount: parsed.nodeCount,
                edgeCount: parsed.edgeCount
            });
            logger.info('graphify_build_completed', {
                path: projectPath,
                graphPath: graphPath(projectPath),
                state,
                output: truncate(output, 1200)
            });
            this.addToGlobal(projectPath).catch(err => {
                logger.warn('graphify_global_add_failed', { path: projectPath, error: err.message });
            });
            return {
                graphPath: graphPath(projectPath),
                output,
                build: buildStatus
            };
        } catch (err) {
            const completedAt = new Date();
            this.writeBuildStatus(projectPath, {
                state: 'failed',
                message: err.message,
                startedAt: startedAt.toISOString(),
                completedAt: completedAt.toISOString(),
                durationMs: completedAt.getTime() - startedAt.getTime()
            });
            throw err;
        }
    },

    readBuildStatus(projectPath) {
        const currentBuildStatusPath = buildStatusPath(projectPath);
        if (!safeFilePath(currentBuildStatusPath, graphifyOutPath(projectPath))) {
            return { state: 'idle' };
        }
        try {
            return JSON.parse(fs.readFileSync(currentBuildStatusPath, 'utf8'));
        } catch (_err) {
            // The status file is written by a build in flight, so a partial or
            // absent read is expected mid-write. The caller is told plainly via
            // the returned message rather than through a log nobody reads.
            return { state: 'idle', message: 'Build status could not be read' };
        }
    },

    writeBuildStatus(projectPath, status) {
        const outDir = graphifyOutPath(projectPath);
        fs.mkdirSync(outDir, { recursive: true });
        const nextStatus = {
            state: status.state || 'idle',
            updatedAt: new Date().toISOString(),
            ...status
        };
        fs.writeFileSync(buildStatusPath(projectPath), JSON.stringify(nextStatus, null, 2));
        return nextStatus;
    },

    status(projectPath, options = {}) {
        const currentGraphPath = graphPath(projectPath);
        const currentReportPath = reportPath(projectPath);
        const graphExists = fs.existsSync(currentGraphPath);
        const reportExists = fs.existsSync(currentReportPath);
        const graphStat = graphExists ? fs.statSync(currentGraphPath) : null;
        const reportStat = reportExists ? fs.statSync(currentReportPath) : null;
        const build = summarizeBuildStatus(projectPath, this.readBuildStatus(projectPath), options);
        const artifacts = Object.fromEntries(Object.keys(ARTIFACTS).map(type => [
            type,
            artifactMetadata(projectPath, type, build)
        ]));

        return {
            available: Boolean(getGraphifyBin()),
            binary: getGraphifyBin(),
            graphPath: currentGraphPath,
            reportPath: currentReportPath,
            graphExists,
            reportExists,
            graphUpdatedAt: graphStat?.mtime?.toISOString(),
            reportUpdatedAt: reportStat?.mtime?.toISOString(),
            artifacts,
            build
        };
    },

    artifact(projectPath, type) {
        const currentArtifactPath = artifactPath(projectPath, type);
        if (!safeFilePath(currentArtifactPath, graphifyOutPath(projectPath))) {
            throw artifactMissingError(currentArtifactPath);
        }

        return {
            type,
            artifactPath: currentArtifactPath,
            filename: path.basename(currentArtifactPath)
        };
    },

    readArtifact(projectPath, type) {
        const artifact = this.artifact(projectPath, type);
        const html = fs.readFileSync(artifact.artifactPath, 'utf8');
        return localizeVendorScripts(enhanceArtifactHtml(html));
    },

    readReport(projectPath, { maxChars = 8000 } = {}) {
        const currentReportPath = reportPath(projectPath);
        if (!safeFilePath(currentReportPath, graphifyOutPath(projectPath))) return '';
        return truncate(fs.readFileSync(currentReportPath, 'utf8'), maxChars);
    },

    readGraph(projectPath) {
        const currentGraphPath = graphPath(projectPath);
        if (!fs.existsSync(currentGraphPath)) {
            throw new Error(`Graphify graph not found: ${currentGraphPath}`);
        }
        return JSON.parse(fs.readFileSync(currentGraphPath, 'utf8'));
    },

    async map(projectPath, { limit = 80 } = {}) {
        await this.ensureGraph(projectPath);
        const graph = this.readGraph(projectPath);
        const nodes = (graph.nodes || []).slice(0, Number(limit || 80)).map(node => ({
            id: node.id,
            label: node.label || node.id,
            community: node.community,
            fileType: node.file_type,
            sourceFile: node.source_file,
            sourceLocation: node.source_location
        }));
        const nodeIds = new Set(nodes.map(node => node.id));
        const links = (graph.links || [])
            .filter(link => nodeIds.has(link.source) && nodeIds.has(link.target))
            .slice(0, Number(limit || 80) * 2)
            .map(link => ({
                source: link.source,
                target: link.target,
                relation: link.relation,
                confidence: link.confidence,
                sourceFile: link.source_file,
                sourceLocation: link.source_location
            }));

        const communities = nodes.reduce((acc, node) => {
            const key = String(node.community ?? 'unknown');
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});

        return {
            graphPath: graphPath(projectPath),
            totalNodes: (graph.nodes || []).length,
            totalLinks: (graph.links || []).length,
            communities,
            nodes,
            links
        };
    },

    async ensureGraph(projectPath) {
        const currentFreshness = this.freshness(projectPath);
        if (hasGraph(projectPath) && !currentFreshness.stale) {
            return { graphPath: graphPath(projectPath), built: false, stale: false };
        }
        const result = await this.build(projectPath);
        return { ...result, built: true, stale: currentFreshness.stale };
    },

    async query(question, projectPath) {
        await this.ensureGraph(projectPath);
        const result = await runGraphify(['query', question, '--graph', graphPath(projectPath)]);
        const insights = truncate(result.stdout || result.stderr);
        logger.info('graphify_query_completed', {
            path: projectPath,
            graphPath: graphPath(projectPath),
            outputChars: insights.length
        });
        return insights;
    },

    async explain(node, projectPath) {
        await this.ensureGraph(projectPath);
        const result = await runGraphify(['explain', node, '--graph', graphPath(projectPath)]);
        return truncate(result.stdout || result.stderr);
    },

    async pathBetween(source, target, projectPath) {
        await this.ensureGraph(projectPath);
        const result = await runGraphify(['path', source, target, '--graph', graphPath(projectPath)]);
        return truncate(result.stdout || result.stderr);
    },

    async affected(node, projectPath, { depth = 2, relations = [] } = {}) {
        await this.ensureGraph(projectPath);
        const args = ['affected', node, '--depth', String(depth), '--graph', graphPath(projectPath)];
        for (const relation of relations || []) {
            if (relation) args.push('--relation', relation);
        }
        const result = await runGraphify(args);
        return truncate(result.stdout || result.stderr);
    },

    async tree(projectPath) {
        await this.ensureGraph(projectPath);
        const output = path.join(projectPath, 'graphify-out', 'GRAPH_TREE.html');
        const result = await runGraphify([
            'tree',
            '--graph',
            graphPath(projectPath),
            '--output',
            output,
            '--label',
            path.basename(projectPath)
        ]);
        return { output, message: result.stdout || result.stderr };
    },

    freshness(projectPath, { scanSources = true } = {}) {
        const currentStatus = this.status(projectPath);
        const sourceMtime = scanSources ? latestSourceMtime(projectPath) : 0;
        const graphMtime = currentStatus.graphUpdatedAt ? new Date(currentStatus.graphUpdatedAt).getTime() : 0;
        const sourceUpdatedAt = sourceMtime ? new Date(sourceMtime).toISOString() : undefined;
        return {
            ...currentStatus,
            latestSourceUpdatedAt: sourceUpdatedAt,
            stale: !currentStatus.graphExists || (scanSources && sourceMtime > graphMtime)
        };
    },

    async saveResult(projectPath, { question, answer, type = 'query', nodes = [] }) {
        await this.ensureGraph(projectPath);
        const memoryDir = path.join(projectPath, 'graphify-out', 'memory');
        const args = [
            'save-result',
            '--question',
            question,
            '--answer',
            answer,
            '--type',
            type,
            '--memory-dir',
            memoryDir
        ];
        if (nodes.length > 0) args.push('--nodes', ...nodes);
        const result = await runGraphify(args);
        return { memoryDir, output: result.stdout || result.stderr };
    },

    async addToGlobal(projectPath) {
        if (!hasGraph(projectPath)) return { skipped: true };
        const result = await runGraphify([
            'global',
            'add',
            graphPath(projectPath),
            '--as',
            path.basename(projectPath)
        ]);
        return { output: result.stdout || result.stderr };
    }
};
