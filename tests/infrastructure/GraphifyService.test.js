const fs = require('fs');
const os = require('os');
const path = require('path');
const graphifyService = require('../../backend/infrastructure/GraphifyService');

describe('GraphifyService build status', () => {
    let workspace;

    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-graphify-service-'));
        fs.mkdirSync(path.join(workspace, 'graphify-out'), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    test('status reports partial visualization state when graph exists but full artifacts are skipped', () => {
        fs.writeFileSync(path.join(workspace, 'graphify-out', 'graph.json'), JSON.stringify({ nodes: [], links: [] }));
        fs.writeFileSync(path.join(workspace, 'graphify-out', 'GRAPH_REPORT.md'), '# Report');

        graphifyService.writeBuildStatus(workspace, {
            state: 'partial',
            message: 'Graphify graph built with skipped visualizations',
            skippedArtifacts: {
                mindmap: 'Graph has 129204 nodes - too large for HTML viz (limit: 5000)',
                visualizer: 'Graph has 129204 nodes - too large for HTML viz (limit: 5000)'
            },
            nodeCount: 129204,
            edgeCount: 534409
        });

        const status = graphifyService.status(workspace);

        expect(status.graphExists).toBe(true);
        expect(status.reportExists).toBe(true);
        expect(status.artifacts.mindmap.exists).toBe(false);
        expect(status.artifacts.mindmap.skippedReason).toContain('too large');
        expect(status.build.state).toBe('partial');
        expect(status.build.nodeCount).toBe(129204);
    });

    test('readBuildStatus returns idle when no status has been persisted', () => {
        expect(graphifyService.readBuildStatus(workspace)).toEqual(expect.objectContaining({
            state: 'idle'
        }));
    });

    test('status upgrades succeeded builds to partial when visualization artifacts are missing', () => {
        fs.writeFileSync(path.join(workspace, 'graphify-out', 'graph.json'), JSON.stringify({ nodes: [], links: [] }));
        fs.writeFileSync(path.join(workspace, 'graphify-out', 'GRAPH_REPORT.md'), '# Report');

        graphifyService.writeBuildStatus(workspace, {
            state: 'succeeded',
            message: 'Graphify build completed',
            nodeCount: 129204,
            edgeCount: 534409
        });

        const status = graphifyService.status(workspace);

        expect(status.build.state).toBe('partial');
        expect(status.build.message).toContain('visualization');
        expect(status.artifacts.mindmap.skippedReason).toContain('visualization');
        expect(status.artifacts.visualizer.skippedReason).toContain('visualization');
    });

    test('status clears stale running builds when generated mind map output exists', () => {
        fs.writeFileSync(path.join(workspace, 'graphify-out', 'graph.json'), JSON.stringify({ nodes: [], links: [] }));
        fs.writeFileSync(path.join(workspace, 'graphify-out', 'graph.html'), '<html><body>graph</body></html>');
        graphifyService.writeBuildStatus(workspace, {
            state: 'running',
            message: 'Graphify build running',
            startedAt: '2026-06-02T10:43:28.784Z',
            updatedAt: '2026-06-02T10:43:28.785Z'
        });

        const status = graphifyService.status(workspace, {
            now: new Date('2026-06-02T13:35:00.000Z')
        });

        expect(status.graphExists).toBe(true);
        expect(status.artifacts.mindmap.exists).toBe(true);
        expect(status.build.state).toBe('succeeded');
        expect(status.build.message).toContain('stale');
    });

    test('graphifyEnvironment sets a larger default HTML visualization limit', () => {
        const env = graphifyService.graphifyEnvironment();

        expect(env.GRAPHIFY_VIZ_NODE_LIMIT).toBe('25000');
    });

    test('needsArtifactRegeneration detects unchanged builds with missing visual output', () => {
        expect(graphifyService.needsArtifactRegeneration({
            output: '[graphify watch] No code-graph topology changes detected; outputs left untouched.',
            missingArtifacts: ['mindmap'],
            graphExists: true
        })).toBe(true);
    });

    test('enhanceArtifactHtml replaces generic community labels with source-based labels', () => {
        const html = `
<script>
const RAW_NODES = [{"id":"one","label":"publishMenu()","community":7,"community_name":"Community 7","source_file":"Anchorstay/web/menu.js"},{"id":"two","label":"MenuPage","community":7,"community_name":"Community 7","source_file":"Anchorstay/web/menu.js"}];
const RAW_EDGES = [];
const LEGEND = [{"cid":7,"color":"#fff","label":"Community 7","count":2}];
</script>`;

        const enhanced = graphifyService.enhanceArtifactHtml(html);

        expect(enhanced).toContain('"label":"menu.js cluster"');
        expect(enhanced).toContain('"community_name":"menu.js cluster"');
        expect(enhanced).not.toContain('"label":"Community 7"');
    });

    test('freshness can skip expensive source tree scans for status endpoints', () => {
        fs.writeFileSync(path.join(workspace, 'graphify-out', 'graph.json'), JSON.stringify({ nodes: [], links: [] }));
        const status = graphifyService.freshness(workspace, { scanSources: false });

        expect(status.graphExists).toBe(true);
        expect(status.latestSourceUpdatedAt).toBeUndefined();
        expect(status.stale).toBe(false);
    });
});

describe('GraphifyService vendor script localization', () => {
    // Graphify emits artifacts that load vis-network from unpkg. For a
    // local-first product a graph must render with no network access, and the
    // CDN reference forced the artifact CSP to allow an external origin plus
    // 'unsafe-eval'. readArtifact rewrites the tag to a locally served copy.
    let workspace;

    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-graphify-vendor-'));
        fs.mkdirSync(path.join(workspace, 'graphify-out'), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    function writeArtifact(html) {
        fs.writeFileSync(path.join(workspace, 'graphify-out', 'graph.html'), html);
    }

    test('rewrites the unpkg vis-network tag to the local vendor copy', () => {
        writeArtifact(
            '<html><head>'
            + '<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"></script>'
            + '</head><body><div id="net"></div></body></html>'
        );

        const served = graphifyService.readArtifact(workspace, 'mindmap');

        expect(served).not.toContain('unpkg.com');
        expect(served).toContain('<script src="/vendor/vis-network.min.js">');
    });

    test('rewrites regardless of the pinned vis-network version', () => {
        writeArtifact('<script src="https://unpkg.com/vis-network@9.2.0/standalone/umd/vis-network.min.js"></script>');

        expect(graphifyService.readArtifact(workspace, 'mindmap')).toContain('/vendor/vis-network.min.js');
    });

    test('leaves an artifact with no remote scripts untouched', () => {
        const html = '<html><body><script>const x = 1;</script></body></html>';
        writeArtifact(html);

        expect(graphifyService.readArtifact(workspace, 'mindmap')).toBe(html);
    });

    test('warns rather than silently serving an unmatched remote script', () => {
        // If Graphify changes its output the CSP will block the CDN and the
        // graph renders blank — that must be diagnosable from the logs.
        const logger = require('../../backend/infrastructure/Logger');
        const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
        writeArtifact('<script src="https://cdn.example.com/other-lib.js"></script>');

        graphifyService.readArtifact(workspace, 'mindmap');

        expect(warn).toHaveBeenCalledWith(
            'graphify_artifact_vendor_rewrite_missed',
            expect.objectContaining({ vendor: 'vis-network' })
        );
        warn.mockRestore();
    });
});
