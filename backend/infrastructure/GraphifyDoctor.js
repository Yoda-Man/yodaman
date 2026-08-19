const fs = require('fs');
const path = require('path');
const graphifyService = require('./GraphifyService');

function projectName(projectPath) {
    return path.basename(projectPath);
}

function readConfig(configPath) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return (config.watchedDirectories || []).map(projectPath => ({
        name: projectName(projectPath),
        path: projectPath
    }));
}

function readGraph(projectPath) {
    try {
        return graphifyService.readGraph(projectPath);
    } catch (_err) {
        // A workspace with no graph yet is the normal state before the first
        // build, not a failure. The doctor reports it as "no graph" from the
        // null rather than from a log line.
        return null;
    }
}

function sourceFileForNode(node) {
    return node.source_file || node.sourceFile || node.file || node.label || node.id || 'unknown';
}

function analyzeProject(project) {
    const status = graphifyService.status(project.path);
    const graph = status.graphExists ? readGraph(project.path) : null;
    const nodes = graph?.nodes || [];
    const links = graph?.links || graph?.edges || [];
    const degreeByNode = new Map(nodes.map(node => [node.id, 0]));
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const dependencyCountByFile = new Map();

    for (const link of links) {
        if (degreeByNode.has(link.source)) degreeByNode.set(link.source, degreeByNode.get(link.source) + 1);
        if (degreeByNode.has(link.target)) degreeByNode.set(link.target, degreeByNode.get(link.target) + 1);
        const sourceNode = nodeById.get(link.source);
        const file = link.source_file || sourceNode?.source_file;
        if (file) dependencyCountByFile.set(file, (dependencyCountByFile.get(file) || 0) + 1);
    }

    const orphanedNodes = nodes.length > 1 ? nodes.filter(node => degreeByNode.get(node.id) === 0).length : 0;
    let mostComplexFile = null;
    for (const [file, dependencyCount] of dependencyCountByFile.entries()) {
        if (!mostComplexFile || dependencyCount > mostComplexFile.dependencyCount) {
            mostComplexFile = { file, dependencyCount };
        }
    }
    if (!mostComplexFile && nodes.length > 0) {
        mostComplexFile = {
            file: sourceFileForNode(nodes[0]),
            dependencyCount: 0
        };
    }

    return {
        ...project,
        status,
        graphExists: Boolean(status.graphExists),
        stale: status.build?.state === 'failed' || status.build?.state === 'running',
        graphUpdatedAt: status.graphUpdatedAt,
        build: status.build || {},
        nodeCount: nodes.length,
        edgeCount: links.length,
        orphanedNodes,
        mostComplexFile
    };
}

function buildGraphDoctorReport({ projects, now = new Date() }) {
    const projectReports = projects.map(analyzeProject);
    const activeProjects = projectReports.filter(project => project.graphExists).length;
    const totalProjects = projectReports.length;
    const freshProjects = projectReports.filter(project => project.graphExists && !project.stale).length;
    const freshnessPercent = totalProjects === 0 ? 0 : Math.round((freshProjects / totalProjects) * 100);
    const lastBuildAt = projectReports
        .map(project => project.build.completedAt || project.graphUpdatedAt)
        .filter(Boolean)
        .map(value => new Date(value))
        .filter(value => !Number.isNaN(value.getTime()))
        .sort((a, b) => b.getTime() - a.getTime())[0];
    const orphanWarnings = projectReports
        .filter(project => project.orphanedNodes > 0)
        .map(project => ({
            name: project.name,
            path: project.path,
            orphanedNodes: project.orphanedNodes
        }));
    const tip = projectReports
        .map(project => project.mostComplexFile)
        .filter(Boolean)
        .sort((a, b) => b.dependencyCount - a.dependencyCount)[0] || null;

    return {
        activeProjects,
        totalProjects,
        freshnessPercent,
        lastBuildAt: lastBuildAt?.toISOString(),
        lastBuildLabel: lastBuildAt ? relativeTime(lastBuildAt, now) : 'never',
        orphanWarnings,
        tip,
        projects: projectReports
    };
}

function relativeTime(date, now = new Date()) {
    const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
    const units = [
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60]
    ];
    for (const [label, size] of units) {
        if (seconds >= size) {
            const value = Math.round(seconds / size);
            return `${value} ${label}${value === 1 ? '' : 's'} ago`;
        }
    }
    return 'just now';
}

function formatGraphDoctorReport(report) {
    const lines = [
        `✓ Graphify active for ${report.activeProjects} project${report.activeProjects === 1 ? '' : 's'}`,
        `✓ Knowledge graph freshness: ${report.freshnessPercent}% (last build ${report.lastBuildLabel})`
    ];

    if (report.orphanWarnings.length === 0) {
        lines.push('✓ No orphaned graph nodes detected');
    } else {
        for (const warning of report.orphanWarnings) {
            lines.push(`⚠️ Project "${warning.name}" has ${warning.orphanedNodes} orphaned node${warning.orphanedNodes === 1 ? '' : 's'} (run Sync Repository or POST /api/reindex)`);
        }
    }

    if (report.tip) {
        lines.push(`💡 Tip: Most complex file is "${report.tip.file}" (${report.tip.dependencyCount} dependencies)`);
    }

    return lines.join('\n');
}

function runGraphDoctor({ configPath = path.join(process.cwd(), 'config.json'), now = new Date() } = {}) {
    const projects = readConfig(configPath);
    return buildGraphDoctorReport({ projects, now });
}

module.exports = {
    readConfig,
    analyzeProject,
    buildGraphDoctorReport,
    formatGraphDoctorReport,
    runGraphDoctor,
    relativeTime
};
