/**
 * DependencyDoctor — Runtime dependency health report for the CLI.
 *
 * Wraps DependencyChecker.checkAll() into a report suitable for
 * `yodaman doctor`, so the same dependency set the runtime validates at
 * startup (Ollama, Context Expert, Graphify, OpenSpec) can be verified from
 * a terminal before the app is launched.
 *
 * Exports:
 *   REQUIRED_DEPENDENCIES              → ordered dependency metadata
 *   buildDependencyReport({ checks })  → structured report
 *   formatDependencyReport(report)     → human-readable text
 *   runDependencyDoctor()              → Promise<report>
 */

const dependencyChecker = require('./DependencyChecker');
const logger = require('./Logger');

// Ordered so the report reads the same way every run. `required: true`
// dependencies make the doctor exit non-zero when missing.
const REQUIRED_DEPENDENCIES = [
    { name: 'ollama', label: 'Ollama', required: true, purpose: 'local LLM inference for chat and agent reasoning' },
    { name: 'ctx', label: 'Context Expert (ctx)', required: true, purpose: 'semantic code indexing and search' },
    { name: 'graphify', label: 'Graphify', required: true, purpose: 'knowledge graph builds and graph-aware answers' },
    { name: 'openspec', label: 'OpenSpec', required: true, purpose: 'Stardust spec-driven change workflow' }
];

/**
 * Turn raw DependencyChecker results into an ordered, annotated report.
 *
 * @param {{ checks: Record<string, object> }} params
 * @returns {{ dependencies: object[], missing: object[], notRunning: object[], ok: boolean, checkedAt: string }}
 */
function buildDependencyReport({ checks = {}, now = new Date() } = {}) {
    const dependencies = REQUIRED_DEPENDENCIES.map(meta => {
        const check = checks[meta.name] || {};
        return {
            name: meta.name,
            label: meta.label,
            required: meta.required,
            purpose: meta.purpose,
            found: check.found === true,
            version: check.version || null,
            path: check.path || null,
            // `running` is null for tools with no health endpoint (ctx, graphify,
            // openspec) — only Ollama exposes one, so null is not a failure.
            running: check.running === undefined ? null : check.running,
            runningUrl: check.runningUrl || null,
            installHint: check.installHint || check.installUrl || null,
            error: check.error || null,
            ok: check.found === true && check.running !== false
        };
    });

    const missing = dependencies.filter(d => !d.found);
    const notRunning = dependencies.filter(d => d.found && d.running === false);

    return {
        dependencies,
        missing,
        notRunning,
        ok: missing.length === 0 && notRunning.length === 0,
        checkedAt: now.toISOString()
    };
}

/**
 * Format a version for display. Some tools report a label instead of a number
 * (graphify uses "installed"), so the "v" prefix is only added to real
 * version numbers.
 */
function versionSuffix(version) {
    if (!version) return '';
    return /^\d/.test(version) ? ` v${version}` : ` (${version})`;
}

/**
 * Render the report as terminal output, mirroring `doctor --graph` styling.
 */
function formatDependencyReport(report) {
    const lines = ['YodaMan dependency health', ''];

    for (const dep of report.dependencies) {
        if (!dep.found) {
            lines.push(`✗ ${dep.label} — not installed (${dep.purpose})`);
            if (dep.installHint) lines.push(`    install: ${dep.installHint}`);
            continue;
        }

        const version = versionSuffix(dep.version);
        if (dep.running === false) {
            lines.push(`⚠️ ${dep.label}${version} — installed but not responding at ${dep.runningUrl || 'its health endpoint'}`);
            lines.push(`    start it, then re-run: yodaman doctor`);
            continue;
        }

        const state = dep.running === true ? ' (running)' : '';
        lines.push(`✓ ${dep.label}${version}${state} — ${dep.path}`);
    }

    // A serving window far below the model's capability degrades every answer
    // silently: the prompt is trimmed to fit and nothing says so. Worth a line
    // in the health report, because the fix is one environment variable.
    if (report.context && report.context.small && report.context.advice) {
        lines.push('');
        lines.push(`⚠️ Ollama context window${report.context.declared ? ` — model supports ${report.context.declared.toLocaleString()} tokens` : ''}`);
        lines.push(`    ${report.context.advice}`);
    } else if (report.context && report.context.effective) {
        lines.push(`✓ Ollama context window — ${report.context.effective.toLocaleString()} tokens configured`);
    }

    lines.push('');
    if (report.ok) {
        lines.push('✓ All required dependencies are installed and reachable.');
    } else {
        const problems = [];
        if (report.missing.length) problems.push(`${report.missing.length} missing`);
        if (report.notRunning.length) problems.push(`${report.notRunning.length} not responding`);
        lines.push(`⚠️ Degraded: ${problems.join(', ')}. YodaMan will start, but affected features are unavailable.`);
        lines.push('💡 Tip: run "yodaman doctor --graph" to check knowledge graph freshness once dependencies are healthy.');
    }

    return lines.join('\n');
}

/**
 * Check every required dependency and log a structured summary.
 */
async function runDependencyDoctor({ now = new Date() } = {}) {
    // Reported alongside the dependencies because it is a dependency in
    // practice: the window Ollama serves decides how much of the prompt the
    // model ever sees.
    let context;
    try {
        context = await dependencyChecker.detectOllamaContext();
    } catch (_err) {
        // Advisory: the report is about dependencies, and an unreachable Ollama is
        // already reported by the ollama check itself. Null just omits the line.
        context = null;
    }

    const checks = await dependencyChecker.checkAll();
    const report = buildDependencyReport({ checks, now });
    report.context = context;

    logger.info('dependency_doctor_completed', {
        ok: report.ok,
        checked: report.dependencies.length,
        missing: report.missing.map(d => d.name),
        notRunning: report.notRunning.map(d => d.name),
        versions: report.dependencies.reduce((acc, d) => {
            acc[d.name] = d.version;
            return acc;
        }, {})
    });

    return report;
}

module.exports = {
    REQUIRED_DEPENDENCIES,
    buildDependencyReport,
    formatDependencyReport,
    runDependencyDoctor,
    versionSuffix
};
