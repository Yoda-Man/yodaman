const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const logger = require('./Logger');

const DEFAULT_TIMEOUT_MS = Number(process.env.YODAMAN_GRAPHIFY_TIMEOUT_MS || 120000);
const DEFAULT_OLLAMA_MODEL = process.env.YODAMAN_GRAPHIFY_OLLAMA_MODEL || 'qwen3:5b';
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
    const env = { ...process.env };
    CLOUD_MODEL_KEYS.forEach(key => {
        delete env[key];
    });

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

function existingReportPath(projectPath) {
    const found = REPORT_FILENAMES
        .map(filename => path.join(graphifyOutPath(projectPath), filename))
        .find(candidate => fs.existsSync(candidate));
    return found || path.join(graphifyOutPath(projectPath), REPORT_FILENAMES[0]);
}

function reportPath(projectPath) {
    return existingReportPath(projectPath);
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

module.exports = {
    graphPath,
    reportPath,
    artifactPath,
    artifactTypes: () => Object.keys(ARTIFACTS),
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
        const result = await runGraphify(args);
        logger.info('graphify_build_completed', {
            path: projectPath,
            graphPath: graphPath(projectPath),
            output: truncate(result.stdout || result.stderr, 1200)
        });
        this.addToGlobal(projectPath).catch(err => {
            logger.warn('graphify_global_add_failed', { path: projectPath, error: err.message });
        });
        return {
            graphPath: graphPath(projectPath),
            output: result.stdout || result.stderr
        };
    },

    status(projectPath) {
        const currentGraphPath = graphPath(projectPath);
        const currentReportPath = reportPath(projectPath);
        const graphExists = fs.existsSync(currentGraphPath);
        const reportExists = fs.existsSync(currentReportPath);
        const graphStat = graphExists ? fs.statSync(currentGraphPath) : null;
        const reportStat = reportExists ? fs.statSync(currentReportPath) : null;

        return {
            available: Boolean(getGraphifyBin()),
            binary: getGraphifyBin(),
            graphPath: currentGraphPath,
            reportPath: currentReportPath,
            graphExists,
            reportExists,
            graphUpdatedAt: graphStat?.mtime?.toISOString(),
            reportUpdatedAt: reportStat?.mtime?.toISOString(),
            artifacts: Object.fromEntries(Object.keys(ARTIFACTS).map(type => {
                const currentArtifactPath = artifactPath(projectPath, type);
                const exists = fs.existsSync(currentArtifactPath);
                const stat = exists ? fs.statSync(currentArtifactPath) : null;
                return [type, {
                    path: currentArtifactPath,
                    exists,
                    updatedAt: stat?.mtime?.toISOString()
                }];
            }))
        };
    },

    artifact(projectPath, type) {
        const currentArtifactPath = artifactPath(projectPath, type);
        let stat;
        try {
            stat = fs.lstatSync(currentArtifactPath);
        } catch (err) {
            throw artifactMissingError(currentArtifactPath);
        }

        if (stat.isSymbolicLink() || !stat.isFile()) {
            throw artifactMissingError(currentArtifactPath);
        }

        const outDir = fs.realpathSync(graphifyOutPath(projectPath));
        const realArtifactPath = fs.realpathSync(currentArtifactPath);
        const relativeArtifactPath = path.relative(outDir, realArtifactPath);
        if (relativeArtifactPath.startsWith('..') || path.isAbsolute(relativeArtifactPath)) {
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
        if (!fs.existsSync(currentReportPath)) return '';
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
