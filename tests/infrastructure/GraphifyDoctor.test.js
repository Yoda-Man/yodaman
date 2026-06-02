const fs = require('fs');
const os = require('os');
const path = require('path');
const graphifyDoctor = require('../../backend/infrastructure/GraphifyDoctor');

describe('GraphifyDoctor', () => {
    let root;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-graph-doctor-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function writeProject(name, graph, buildStatus = {}) {
        const projectPath = path.join(root, name);
        const outDir = path.join(projectPath, 'graphify-out');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify(graph, null, 2));
        fs.writeFileSync(path.join(outDir, 'graph_report.md'), '# Report');
        fs.writeFileSync(path.join(outDir, 'yodaman-build-status.json'), JSON.stringify(buildStatus, null, 2));
        return projectPath;
    }

    test('buildGraphDoctorReport summarizes active graphs, freshness, orphaned nodes, and most complex file', () => {
        const apiPath = writeProject('legacy-api', {
            nodes: [
                { id: 'file_a', label: 'payment-processor.js', source_file: 'src/payment-processor.js' },
                { id: 'fn_a', label: 'charge()', source_file: 'src/payment-processor.js' },
                { id: 'fn_b', label: 'refund()', source_file: 'src/payment-processor.js' },
                { id: 'orphan', label: 'unused()', source_file: 'src/unused.js' }
            ],
            links: [
                { source: 'file_a', target: 'fn_a', source_file: 'src/payment-processor.js' },
                { source: 'file_a', target: 'fn_b', source_file: 'src/payment-processor.js' }
            ]
        }, {
            state: 'succeeded',
            completedAt: '2026-06-02T06:00:00.000Z'
        });
        const docsPath = writeProject('docs', {
            nodes: [{ id: 'readme', label: 'README.md', source_file: 'README.md' }],
            links: []
        }, {
            state: 'succeeded',
            completedAt: '2026-06-02T07:00:00.000Z'
        });
        const missingPath = path.join(root, 'missing');
        fs.mkdirSync(missingPath, { recursive: true });

        const report = graphifyDoctor.buildGraphDoctorReport({
            projects: [
                { name: 'legacy-api', path: apiPath },
                { name: 'docs', path: docsPath },
                { name: 'missing', path: missingPath }
            ],
            now: new Date('2026-06-02T08:00:00.000Z')
        });

        expect(report.activeProjects).toBe(2);
        expect(report.totalProjects).toBe(3);
        expect(report.freshnessPercent).toBe(67);
        expect(report.lastBuildLabel).toBe('1 hour ago');
        expect(report.orphanWarnings).toEqual([
            expect.objectContaining({ name: 'legacy-api', orphanedNodes: 1 })
        ]);
        expect(report.tip).toEqual(expect.objectContaining({
            file: 'src/payment-processor.js',
            dependencyCount: 2
        }));
        expect(graphifyDoctor.formatGraphDoctorReport(report)).toContain('Graphify active for 2 projects');
    });
});
