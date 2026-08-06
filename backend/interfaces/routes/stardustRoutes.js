/**
 * Stardust routes — /api/stardust/*
 *
 * OpenSpec dashboard: drift detection, change composition, spec impact, and the
 * live board. Extracted from RestController.js during the W-6 split.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

const specDrift = require('../../stardust/SpecDrift');
const stardustWrapper = require('../../stardust/StardustWrapper');
const stardustLive = require('../../stardust/StardustLive');
const graphFacts = require('../../infrastructure/GraphFacts');
const graphRanker = require('../../infrastructure/GraphRanker');
const impactAnalyzer = require('../../infrastructure/ImpactAnalyzer');
const toolBox = require('../../infrastructure/ToolBox');
const logger = require('../../infrastructure/Logger');
const { jsonError } = require('../support/http');

const router = express.Router();

/**
 * Create an OpenSpec change proposal.
 * Mirrors ToolBox.specPropose so the UI and agent use the same logic.
 */
async function proposeChange(projectRoot, changeName, description) {
    const changeDir = path.join(projectRoot, 'openspec', 'changes', changeName);
    if (!fs.existsSync(changeDir)) fs.mkdirSync(changeDir, { recursive: true });

    const proposalPath = path.join(changeDir, 'proposal.md');
    const designPath = path.join(changeDir, 'design.md');
    const tasksPath = path.join(changeDir, 'tasks.md');

    let created = [];
    if (!fs.existsSync(proposalPath)) {
        fs.writeFileSync(proposalPath, `# ${changeName}\n\n${description || 'Proposed change.'}\n`);
        created.push('proposal.md');
    }
    if (!fs.existsSync(designPath)) {
        fs.writeFileSync(designPath, `# Design: ${changeName}\n\n## Approach\n\n## Tradeoffs\n\n## Affected modules\n`);
        created.push('design.md');
    }
    if (!fs.existsSync(tasksPath)) {
        fs.writeFileSync(tasksPath, `# Tasks: ${changeName}\n\n- [ ] Implement the change\n- [ ] Add tests\n- [ ] Validate against specs\n`);
        created.push('tasks.md');
    }

    const alreadyExisted = ['proposal.md', 'design.md', 'tasks.md'].filter(f => !created.includes(f));
    const msg = created.length > 0
        ? `Change "${changeName}" proposed. Created: ${created.join(', ')}.`
        : `Change "${changeName}" already exists (${alreadyExisted.join(', ')}). Use validate to check it.`;

    return {
        success: true,
        stdout: msg,
        stderr: alreadyExisted.length > 0 ? `Files already exist: ${alreadyExisted.join(', ')}` : '',
        code: 0,
        changeName,
        created,
        alreadyExisted,
    };
}

// ─────────────────────────────────────────────────────────────────────────
//  Stardust — OpenSpec CLI wrapper
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/stardust/drift — Does the code still match the specs?
 *
 * Query: ?projectRoot=<absolute path>
 *
 * OpenSpec holds intended architecture; Graphify holds actual. This diffs them:
 * specs citing files that no longer exist, and load-bearing modules no spec
 * describes. Requires both an initialized OpenSpec and a built graph, and says
 * which is missing rather than failing.
 */
router.get('/stardust/drift', (req, res) => {
    try {
        const projectRoot = req.query.projectRoot || process.cwd();
        const report = specDrift.detectDrift(projectRoot, {
            minDependents: Number(req.query.minDependents) || 2
        });
        return res.json({ ...report, summary: specDrift.formatDrift(report) });
    } catch (err) {
        logger.error('spec_drift_failed', err, { requestId: req.id });
        return jsonError(res, 500, err.message, 'spec_drift_failed');
    }
});

/**
 * GET /api/stardust/context — Graph-grounded context for authoring a change.
 *
 * Query: ?projectRoot=<path>&files=a.js,b.js
 *
 * A spec written without the graph invents module names and under-counts
 * impact. This supplies the real blast radius for each file the change touches,
 * plus the architectural hubs, so a proposal cites modules that exist.
 */
router.get('/stardust/context', (req, res) => {
    try {
        const projectRoot = req.query.projectRoot || process.cwd();
        const files = String(req.query.files || '')
            .split(',')
            .map(file => file.trim())
            .filter(Boolean)
            .slice(0, 25);

        const facts = graphFacts.load(projectRoot);
        if (!facts) {
            return res.json({
                available: false,
                reason: 'no knowledge graph has been built for this workspace yet',
                hint: 'Run Sync Repository, then request context again.'
            });
        }

        return res.json({
            available: true,
            projectRoot,
            graph: { files: facts.files.size, nodes: facts.nodeCount, links: facts.linkCount },
            // Named so a spec author can cite real modules instead of guessing.
            architecturalHubs: graphFacts.centralFiles(projectRoot, { limit: 10, facts }),
            targets: files.map(file => {
                const impact = impactAnalyzer.analyzeFile(projectRoot, file);
                return {
                    file,
                    inGraph: impact.available,
                    impactedCount: impact.impactedCount ?? null,
                    coveringTests: impact.coveringTests ?? [],
                    risk: impact.risk ?? null,
                    dependents: impact.topDependents ?? [],
                    summary: impactAnalyzer.summarize(impact)
                };
            })
        });
    } catch (err) {
        logger.error('stardust_context_failed', err, { requestId: req.id });
        return jsonError(res, 500, err.message, 'stardust_context_failed');
    }
});

router.get('/stardust/diagnose', async (req, res) => {
    try {
        const projectRoot = req.query.projectRoot || process.cwd();
        const result = await stardustWrapper.diagnose(projectRoot);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/stardust/run', async (req, res) => {
    try {
        const { action, changeId, _title, description, _specPath, projectRoot, _dryRun, _strict } = req.body || {};

        if (!action) {
            return res.status(400).json({ error: 'Missing required field: action' });
        }

        let result;
        const opts = { cwd: projectRoot || process.cwd() };

        switch (action) {
            case 'diagnose':
                result = await stardustWrapper.diagnose(opts.cwd);
                break;
            case 'validate':
                if (!changeId) {
                    return res.status(400).json({ error: 'validate requires changeId' });
                }
                result = await stardustWrapper.validate(changeId, opts);
                break;
            case 'archive':
                if (!changeId) {
                    return res.status(400).json({ error: 'archive requires changeId' });
                }
                result = await stardustWrapper.archive(changeId, opts);
                break;
            case 'list':
                result = await stardustWrapper.list({ specs: req.body.specs, cwd: opts.cwd });
                break;
            case 'init':
                if (!projectRoot) {
                    return res.status(400).json({ error: 'init requires projectRoot' });
                }
                result = await stardustWrapper.init(projectRoot, { tools: req.body.tools || 'all' });
                break;
            case 'install':
                result = await stardustWrapper.install();
                break;
            case 'propose':
                if (!changeId) {
                    return res.status(400).json({ error: 'propose requires changeId' });
                }
                result = await proposeChange(opts.cwd, changeId, description || '');
                break;
            default:
                return res.status(400).json({ error: `Unknown stardust action: ${action}` });
        }

        res.json({
            success: result.success,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.code,
            // Include full diagnose result when action is 'diagnose'
            ...(action === 'diagnose' && result._debug ? { diagnostics: result } : {}),
            ...(action === 'diagnose' && !result._debug ? { diagnostics: result } : {}),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────
//  Stardust Live — real-time dashboard REST fallbacks
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/stardust/board — change-board snapshot.
 * Query: ?projectRoot=<absolute path>
 * Returns the same typed Snapshot the WebSocket pushes on connect.
 */
router.get('/stardust/board', (req, res) => {
    try {
        const projectRoot = req.query.projectRoot || process.cwd();
        const snapshot = stardustLive.getSnapshot(projectRoot);
        res.json(snapshot);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/stardust/deltas/:name — operation-grouped spec deltas for a change.
 * Query: ?projectRoot=<absolute path>
 */
router.get('/stardust/deltas/:name', (req, res) => {
    try {
        const projectRoot = req.query.projectRoot || process.cwd();
        const deltas = stardustLive.getDeltas(projectRoot, req.params.name);
        res.json({ change: req.params.name, deltas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/stardust/spec — the current text of a published spec.
 * Query: ?projectRoot=<path>&spec=<spec id, e.g. "auth" or "auth/session">
 *
 * A side-by-side diff needs the left-hand side to be real. Without this the
 * "current spec" column can only restate the proposal, which reads as though the
 * change had already landed.
 */
router.get('/stardust/spec', (req, res) => {
    try {
        const projectRoot = req.query.projectRoot || process.cwd();
        const specId = String(req.query.spec || '').trim();

        if (!specId) {
            return res.status(400).json({ error: 'spec query parameter is required' });
        }

        const root = specDrift.findOpenSpecRoot(projectRoot);
        if (!root) {
            return res.json({ available: false, id: specId, reason: 'OpenSpec is not initialized in this workspace' });
        }

        const specsDir = path.join(root, 'specs');
        const resolved = path.resolve(specsDir, `${specId}.md`);

        // The spec id comes from the client, so confine it to the specs directory.
        if (resolved !== specsDir && !resolved.startsWith(specsDir + path.sep)) {
            return res.status(400).json({ error: 'spec id resolves outside the specs directory' });
        }

        if (!fs.existsSync(resolved)) {
            return res.json({
                available: false,
                id: specId,
                reason: 'no published spec by this name — the change would create it',
            });
        }

        return res.json({
            available: true,
            id: specId,
            path: path.relative(projectRoot, resolved).split(path.sep).join('/'),
            text: fs.readFileSync(resolved, 'utf8'),
        });
    } catch (err) {
        logger.error('stardust_spec_read_failed', err, { requestId: req.id });
        return jsonError(res, 500, err.message, 'stardust_spec_read_failed');
    }
});

/**
 * GET /api/stardust/change-impact/:name — what a proposed change actually touches.
 * Query: ?projectRoot=<absolute path>
 *
 * The board shows what a change intends; this says what carrying it out would
 * disturb. Every source file the change's spec deltas cite is resolved against
 * the graph, so a proposal that reads as a one-line tweak but lands on an
 * untested hub says so before anyone starts on it.
 *
 * Files a delta cites that the graph has never seen are reported as stale rather
 * than dropped — the same signal the Drift tab shows, scoped to one change.
 */
router.get('/stardust/change-impact/:name', (req, res) => {
    try {
        const projectRoot = req.query.projectRoot || process.cwd();
        const changeName = req.params.name;
        const deltas = stardustLive.getDeltas(projectRoot, changeName);

        // Which files does the change's prose cite, and under which requirement?
        const citedBy = new Map();
        for (const delta of deltas) {
            const text = `${delta.requirement || ''}\n${delta.body || ''}`;
            for (const reference of specDrift.extractReferences(text)) {
                if (!citedBy.has(reference)) citedBy.set(reference, new Set());
                citedBy.get(reference).add(delta.requirement || delta.specId);
            }
        }

        const graph = graphFacts.load(projectRoot);
        if (!graph) {
            return res.json({
                change: changeName,
                available: false,
                reason: 'no knowledge graph has been built for this workspace yet',
                deltaCount: deltas.length,
                citedCount: citedBy.size,
                files: [],
            });
        }

        // Specs cite files by name as well as by path, so resolve both ways.
        const byBasename = new Map();
        for (const file of graph.files) {
            const base = path.basename(file);
            if (!byBasename.has(base)) byBasename.set(base, []);
            byBasename.get(base).push(file);
        }

        const files = [];
        for (const [reference, requirements] of citedBy) {
            const resolved = graph.files.has(reference)
                ? reference
                : (byBasename.get(path.basename(reference)) || [])[0] || null;

            if (!resolved) {
                files.push({
                    reference,
                    file: null,
                    inGraph: false,
                    stale: true,
                    requirements: [...requirements],
                });
                continue;
            }

            const impact = impactAnalyzer.analyzeFile(projectRoot, resolved, { depth: 2 });
            files.push({
                reference,
                file: resolved,
                inGraph: true,
                stale: false,
                requirements: [...requirements],
                dependents: graph.dependedOnBy.get(resolved)?.size || 0,
                centrality: graph.degree?.get(resolved) || 0,
                blastRadius: impact.available ? impact.impactedCount : 0,
                coveredByTests: impact.available ? impact.testCount > 0 : false,
                testCount: impact.available ? impact.testCount : 0,
                risk: impact.available ? impact.risk : null,
                summary: impactAnalyzer.summarize(impact),
            });
        }

        // Riskiest first — the reviewer's first question is what could break.
        const RISK_ORDER = { high: 3, moderate: 2, low: 1 };
        files.sort((a, b) =>
            (b.stale ? 1 : 0) - (a.stale ? 1 : 0) ||
            (RISK_ORDER[b.risk] || 0) - (RISK_ORDER[a.risk] || 0) ||
            (b.blastRadius || 0) - (a.blastRadius || 0)
        );

        const tracked = files.filter(entry => entry.inGraph);
        return res.json({
            change: changeName,
            available: true,
            deltaCount: deltas.length,
            citedCount: citedBy.size,
            files,
            totals: {
                inGraph: tracked.length,
                stale: files.length - tracked.length,
                blastRadius: tracked.reduce((sum, entry) => sum + entry.blastRadius, 0),
                untested: tracked.filter(entry => !entry.coveredByTests).length,
                highestRisk: tracked.reduce(
                    (worst, entry) => ((RISK_ORDER[entry.risk] || 0) > (RISK_ORDER[worst] || 0) ? entry.risk : worst),
                    'low'
                ),
            },
        });
    } catch (err) {
        logger.error('stardust_change_impact_failed', err, { requestId: req.id });
        return jsonError(res, 500, err.message, 'stardust_change_impact_failed');
    }
});

/**
 * PUT /api/stardust/validation/:name — store last validation result for a change.
 * Body: { status: 'ok' | 'warn' | 'error' }
 */
router.put('/stardust/validation/:name', (req, res) => {
    try {
        const { status } = req.body;
        if (!['ok', 'warn', 'error'].includes(status)) {
            return res.status(400).json({ error: 'status must be ok, warn, or error' });
        }
        stardustLive.setValidationStatus(req.params.name, status);
        res.json({ ok: true, change: req.params.name, validation: status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────
//  Stardust Compose — cross-reference view combining all three tools
// ─────────────────────────────────────────────────────────────────────────

/**
 * Repo-relative form of a path, accepting either an absolute path or a path that
 * is already relative. `path.relative` alone turns an already-relative input into
 * a chain of `../` segments that matches nothing in the graph.
 */
function toRepoRelative(projectRoot, filePath) {
    const raw = String(filePath || '');
    if (!raw) return '';
    const relative = path.isAbsolute(raw) ? path.relative(projectRoot, raw) : raw;
    return relative.split(path.sep).join('/').replace(/^\.\//, '');
}

/**
 * Does a spec's cited reference point at this file?
 *
 * Specs cite files both fully (`backend/stardust/SpecDrift.js`) and by name
 * (`SpecDrift.js`), so a suffix match on a path boundary covers both. A bare
 * substring test would match `Logger.js` against `AuditLogger.js`.
 */
function referenceMatchesFile(reference, relativeFile) {
    if (!reference || !relativeFile) return false;
    if (reference === relativeFile) return true;
    const longer = reference.length > relativeFile.length ? reference : relativeFile;
    const shorter = reference.length > relativeFile.length ? relativeFile : reference;
    return longer.endsWith(`/${shorter}`);
}

/**
 * GET /api/stardust/compose — file-centric cross-reference.
 * Query: ?projectRoot=<path>&file=<repo-relative path>&depth=1..4&limit=<n>
 *
 * Aggregates all three mandatory tools for a single file, in one response, so the
 * composition happens server-side rather than leaving the UI to stitch three
 * calls together:
 *   - OpenSpec: which specs mention this file (intent)
 *   - Graphify: dependents, centrality, blast radius, test coverage (structure)
 *   - Context Expert: the file's own semantic neighbours (context)
 *
 * Each tool reports its own availability, so one missing tool degrades a single
 * column instead of blanking the view.
 *
 * `depth` and `limit` exist because two views read this endpoint with different
 * needs: Compose wants a short list at the default two hops, while the Impact tab
 * is the deep-dive and drives the hop control itself. Both default to what
 * Compose was already getting, so callers that omit them see no change.
 */
router.get('/stardust/compose', async (req, res) => {
    try {
        const projectRoot = req.query.projectRoot || process.cwd();
        const targetFile = req.query.file;

        if (!targetFile) {
            return res.status(400).json({ error: 'file query parameter is required' });
        }

        // Clamp rather than reject: a bad depth should not fail the whole view.
        const depth = Math.min(4, Math.max(1, Number(req.query.depth) || 2));
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 5));

        const relativeFile = toRepoRelative(projectRoot, targetFile);

        const result = {
            file: relativeFile,
            projectRoot,
            depth,
            available: false,
            openspec: { available: false, mentionedIn: [], specCount: 0, reason: null },
            graphify: {
                available: false,
                inGraph: false,
                dependents: 0,
                centrality: 0,
                blastRadius: 0,
                nearestDependents: [],
                coveredByTests: false,
                testCount: 0,
                testFiles: [],
                risk: null,
                stale: false,
                reason: null,
            },
            contextExpert: { available: false, neighbours: [], graphRanked: false, reason: null },
        };

        // ── OpenSpec: which specs mention this file ──
        try {
            const specs = specDrift.readSpecs(projectRoot);
            result.openspec.specCount = specs.length;
            result.openspec.available = specs.length > 0;
            if (specs.length === 0) {
                result.openspec.reason = 'no specs have been written for this workspace yet';
            }
            for (const spec of specs) {
                const matched = specDrift.extractReferences(spec.text)
                    .filter(reference => referenceMatchesFile(reference, relativeFile));
                if (matched.length > 0) {
                    result.openspec.mentionedIn.push({ spec: spec.id, file: spec.file, references: matched });
                }
            }
        } catch (err) {
            result.openspec.reason = err.message;
        }

        // ── Graphify: structural metrics ──
        try {
            const graph = graphFacts.load(projectRoot);
            if (!graph) {
                result.graphify.reason = 'no knowledge graph has been built for this workspace yet';
            } else {
                result.graphify.available = true;
                result.graphify.inGraph = graph.files.has(relativeFile);
                result.graphify.dependents = graph.dependedOnBy.get(relativeFile)?.size || 0;
                result.graphify.centrality = graph.degree?.get(relativeFile) || 0;

                const impact = impactAnalyzer.analyzeFile(projectRoot, relativeFile, { depth });
                if (impact?.available) {
                    result.graphify.blastRadius = impact.impactedCount;
                    // topDependents is pre-capped at 5 by the analyzer, so read the
                    // full list when the caller asked for more than that.
                    result.graphify.nearestDependents = (impact.dependentFiles || [])
                        .filter(entry => !entry.isTest)
                        .slice(0, limit)
                        .map(entry => entry.file);
                    result.graphify.coveredByTests = impact.testCount > 0;
                    result.graphify.testCount = impact.testCount;
                    result.graphify.testFiles = impact.coveringTests.slice(0, limit);
                    result.graphify.risk = impact.risk;
                    result.graphify.stale = impact.stale;
                } else if (impact?.reason) {
                    result.graphify.reason = impact.reason;
                }
                result.available = true;
            }
        } catch (err) {
            result.graphify.reason = err.message;
        }

        // ── Context Expert: the file's semantic neighbours, ranked with the graph ──
        // Searching the file's own basename is what makes the third tool actually
        // participate: the hits come back carrying Graphify's ranking signal, so
        // this column is Context Expert output already blended with structure.
        try {
            const needle = path.basename(relativeFile).replace(/\.[^.]+$/, '');
            const raw = await toolBox.searchCode({ query: needle, project: projectRoot, top: 8 });
            const ranked = graphRanker.rerank(projectRoot, Array.isArray(raw) ? raw : [], {
                activeFile: relativeFile,
            });
            result.contextExpert.available = ranked.length > 0;
            result.contextExpert.graphRanked = ranked.some(hit => hit && hit.graphSignal);
            result.contextExpert.neighbours = ranked
                .map(hit => ({
                    file: toRepoRelative(projectRoot, hit?.metadata?.path || hit?.path || hit?.file || ''),
                    score: Number(hit?.score) || 0,
                    signal: hit?.graphSignal || null,
                }))
                .filter(hit => hit.file && hit.file !== relativeFile)
                .slice(0, 6);
            if (ranked.length === 0) {
                result.contextExpert.reason = 'Context Expert returned no hits for this file';
            }
        } catch (err) {
            result.contextExpert.reason = err.message;
        }

        res.json(result);
    } catch (err) {
        logger.error('stardust_compose_failed', err, { requestId: req.id });
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
