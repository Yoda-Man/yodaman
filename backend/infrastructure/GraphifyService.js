const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const logger = require('./Logger');

const DEFAULT_TIMEOUT_MS = Number(process.env.YODAMAN_GRAPHIFY_TIMEOUT_MS || 300000);
const DEFAULT_OLLAMA_MODEL = process.env.YODAMAN_GRAPHIFY_OLLAMA_MODEL || 'qwen3:5b';
const DEFAULT_VIZ_NODE_LIMIT = process.env.YODAMAN_GRAPHIFY_VIZ_NODE_LIMIT || '25000';
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
    const candidates = [
        process.env.YODAMAN_GRAPHIFY_BIN,
        ...findUserGraphifyBins(),
        'graphify'
    ].filter(Boolean);

    resolvedGraphifyBin = candidates[0];
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
    } catch (err) {
        return '';
    }

    if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
        return '';
    }

    let stat;
    try {
        stat = fs.lstatSync(filePath);
    } catch (err) {
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
    } catch (err) {
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

function latestSourceMtime(projectPath) {
    const ignored = new Set(['node_modules', '.git', 'dist', 'build', 'release', 'graphify-out']);
    let latest = 0;

    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ignored.has(entry.name)) continue;
            const entryPath = path.join(dir, entry.name);
            let stat;
            try {
                stat = fs.statSync(entryPath);
            } catch (err) {
                continue;
            }

            if (stat.isDirectory()) {
                walk(entryPath);
            } else {
                latest = Math.max(latest, stat.mtimeMs);
            }
        }
    }

    if (fs.existsSync(projectPath)) walk(projectPath);
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

function summarizeBuildStatus(projectPath, buildStatus) {
    const currentGraphPath = graphPath(projectPath);
    const graphExists = fs.existsSync(currentGraphPath);
    const artifacts = Object.fromEntries(Object.keys(ARTIFACTS).map(type => [
        type,
        artifactMetadata(projectPath, type, buildStatus)
    ]));
    const hasAnyArtifact = Object.values(artifacts).some(artifact => artifact.exists);
    const skippedArtifacts = { ...(buildStatus.skippedArtifacts || {}) };

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

module.exports = {
    graphPath,
    reportPath,
    buildStatusPath,
    artifactPath,
    artifactTypes: () => Object.keys(ARTIFACTS),
    graphifyEnvironment,
    needsArtifactRegeneration,
    hasGraph,
    getGraphifyBin,

    async assertAvailable() {
        try {
            await runGraphify(['--help'], { timeoutMs: 10000 });
            logger.info('graphify_available', { binary: getGraphifyBin() });
        } catch (err) {
            logger.error('graphify_unavailable', err, { binary: getGraphifyBin() });
            throw new Error(
                `Graphify is required but "${getGraphifyBin()}" is not available. Install it with "pip install graphifyy" and ensure the "graphify" command is in PATH, or set YODAMAN_GRAPHIFY_BIN.`
            );
        }

        await new Promise((resolve, reject) => {
            execFile('ollama', ['--version'], { timeout: 10000 }, (err) => {
                if (err) {
                    reject(new Error('Ollama is required for local-only Graphify semantic extraction. Install Ollama and make sure the `ollama` command is in PATH.'));
                    return;
                }
                resolve();
            });
        });
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
        } catch (err) {
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

    status(projectPath) {
        const currentGraphPath = graphPath(projectPath);
        const currentReportPath = reportPath(projectPath);
        const graphExists = fs.existsSync(currentGraphPath);
        const reportExists = fs.existsSync(currentReportPath);
        const graphStat = graphExists ? fs.statSync(currentGraphPath) : null;
        const reportStat = reportExists ? fs.statSync(currentReportPath) : null;
        const build = summarizeBuildStatus(projectPath, this.readBuildStatus(projectPath));
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

    freshness(projectPath) {
        const currentStatus = this.status(projectPath);
        const sourceMtime = latestSourceMtime(projectPath);
        const graphMtime = currentStatus.graphUpdatedAt ? new Date(currentStatus.graphUpdatedAt).getTime() : 0;
        const sourceUpdatedAt = sourceMtime ? new Date(sourceMtime).toISOString() : undefined;
        return {
            ...currentStatus,
            latestSourceUpdatedAt: sourceUpdatedAt,
            stale: !currentStatus.graphExists || (sourceMtime > graphMtime)
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
