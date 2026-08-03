const dependencyDoctor = require('../../backend/infrastructure/DependencyDoctor');
const dependencyChecker = require('../../backend/infrastructure/DependencyChecker');
const logger = require('../../backend/infrastructure/Logger');

const HEALTHY_CHECKS = {
    ollama: { found: true, version: '0.30.8', path: '/opt/homebrew/bin/ollama', running: true, runningUrl: 'http://127.0.0.1:11434/api/tags' },
    ctx: { found: true, version: '1.4.0', path: '/usr/local/bin/ctx', running: null },
    graphify: { found: true, version: 'installed', path: '/usr/local/bin/graphify', running: null },
    openspec: { found: true, version: '1.5.0', path: '/usr/local/bin/openspec', running: null }
};

describe('DependencyDoctor', () => {
    describe('required dependency set', () => {
        test('checks OpenSpec alongside Ollama, ctx, and Graphify', () => {
            const names = dependencyDoctor.REQUIRED_DEPENDENCIES.map(d => d.name);
            expect(names).toEqual(['ollama', 'ctx', 'graphify', 'openspec']);
        });

        test('every required dependency is one DependencyChecker knows how to locate', () => {
            for (const dep of dependencyDoctor.REQUIRED_DEPENDENCIES) {
                expect(dependencyChecker.SERVICES[dep.name]).toBeDefined();
            }
        });
    });

    describe('buildDependencyReport', () => {
        test('reports healthy when every dependency is installed and reachable', () => {
            const report = dependencyDoctor.buildDependencyReport({ checks: HEALTHY_CHECKS });

            expect(report.ok).toBe(true);
            expect(report.missing).toEqual([]);
            expect(report.notRunning).toEqual([]);
            expect(report.dependencies).toHaveLength(4);
        });

        test('flags a missing OpenSpec install as not ok', () => {
            const report = dependencyDoctor.buildDependencyReport({
                checks: {
                    ...HEALTHY_CHECKS,
                    openspec: {
                        found: false,
                        error: 'openspec not found',
                        installHint: 'npm install -g @fission-ai/openspec@latest'
                    }
                }
            });

            expect(report.ok).toBe(false);
            expect(report.missing.map(d => d.name)).toEqual(['openspec']);

            const openspec = report.dependencies.find(d => d.name === 'openspec');
            expect(openspec.ok).toBe(false);
            expect(openspec.installHint).toBe('npm install -g @fission-ai/openspec@latest');
        });

        test('treats a tool with no health endpoint as ok when found', () => {
            const report = dependencyDoctor.buildDependencyReport({ checks: HEALTHY_CHECKS });
            const openspec = report.dependencies.find(d => d.name === 'openspec');

            expect(openspec.running).toBeNull();
            expect(openspec.ok).toBe(true);
        });

        test('flags an installed-but-unreachable service as not running', () => {
            const report = dependencyDoctor.buildDependencyReport({
                checks: {
                    ...HEALTHY_CHECKS,
                    ollama: { ...HEALTHY_CHECKS.ollama, running: false }
                }
            });

            expect(report.ok).toBe(false);
            expect(report.missing).toEqual([]);
            expect(report.notRunning.map(d => d.name)).toEqual(['ollama']);
        });

        test('treats a dependency absent from the check results as missing', () => {
            const report = dependencyDoctor.buildDependencyReport({ checks: {} });

            expect(report.ok).toBe(false);
            expect(report.missing.map(d => d.name)).toEqual(['ollama', 'ctx', 'graphify', 'openspec']);
        });
    });

    describe('formatDependencyReport', () => {
        test('lists OpenSpec and confirms overall health', () => {
            const report = dependencyDoctor.buildDependencyReport({ checks: HEALTHY_CHECKS });
            const text = dependencyDoctor.formatDependencyReport(report);

            expect(text).toContain('✓ OpenSpec v1.5.0 — /usr/local/bin/openspec');
            expect(text).toContain('✓ Ollama v0.30.8 (running)');
            expect(text).toContain('All required dependencies are installed and reachable.');
        });

        test('shows the install command for a missing dependency', () => {
            const report = dependencyDoctor.buildDependencyReport({
                checks: {
                    ...HEALTHY_CHECKS,
                    openspec: {
                        found: false,
                        error: 'openspec not found',
                        installHint: 'npm install -g @fission-ai/openspec@latest'
                    }
                }
            });
            const text = dependencyDoctor.formatDependencyReport(report);

            expect(text).toContain('✗ OpenSpec — not installed');
            expect(text).toContain('install: npm install -g @fission-ai/openspec@latest');
            expect(text).toContain('1 missing');
        });

        test('distinguishes an unreachable service from a missing one', () => {
            const report = dependencyDoctor.buildDependencyReport({
                checks: {
                    ...HEALTHY_CHECKS,
                    ollama: { ...HEALTHY_CHECKS.ollama, running: false }
                }
            });
            const text = dependencyDoctor.formatDependencyReport(report);

            expect(text).toContain('⚠️ Ollama v0.30.8 — installed but not responding');
            expect(text).toContain('1 not responding');
        });

        test('labels a non-numeric version without a bogus "v" prefix', () => {
            expect(dependencyDoctor.versionSuffix('installed')).toBe(' (installed)');
            expect(dependencyDoctor.versionSuffix('1.5.0')).toBe(' v1.5.0');
            expect(dependencyDoctor.versionSuffix(null)).toBe('');
        });
    });

    describe('runDependencyDoctor', () => {
        const originalCheckAll = dependencyChecker.checkAll;

        afterEach(() => {
            dependencyChecker.checkAll = originalCheckAll;
        });

        test('checks all dependencies and logs a structured summary', async () => {
            dependencyChecker.checkAll = jest.fn(async () => ({
                ...HEALTHY_CHECKS,
                openspec: { found: false, error: 'openspec not found' }
            }));
            const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => { });

            try {
                const report = await dependencyDoctor.runDependencyDoctor();

                expect(dependencyChecker.checkAll).toHaveBeenCalled();
                expect(report.ok).toBe(false);
                expect(infoSpy).toHaveBeenCalledWith('dependency_doctor_completed', expect.objectContaining({
                    ok: false,
                    checked: 4,
                    missing: ['openspec']
                }));
            } finally {
                infoSpy.mockRestore();
            }
        });
    });
});
