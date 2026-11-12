#!/usr/bin/env node
/**
 * The real tools, run for real, before anything ships.
 *
 * Every other gate mocks Context Expert, Graphify and OpenSpec. So 0.6.4
 * shipped from a machine whose Graphify could not start (Homebrew had removed
 * the Python its launcher named) and nothing failed: the health check trusted
 * that the file existed, and no step ever built a graph. This checks each
 * required tool starts, then builds a real graph of a small sample project.
 */
// Its runtime pieces log here, not into the user's ~/.yodaman/logs/runtime.log.
process.env.YODAMAN_LOG_DIR = process.env.YODAMAN_LOG_DIR || require('path').join(require('os').tmpdir(), 'yodaman-smoke-logs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dependencyChecker = require('../backend/infrastructure/DependencyChecker');
const graphifyService = require('../backend/infrastructure/GraphifyService');

const REQUIRED = ['ctx', 'graphify', 'openspec', 'ollama'];

async function main() {
    const checks = await dependencyChecker.checkAll();
    const broken = REQUIRED.filter((name) => !checks[name]?.found);
    for (const name of REQUIRED) {
        const c = checks[name] || {};
        console.log(`${c.found ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} ${c.found ? `${c.version} at ${c.path}` : c.error}`);
    }
    if (broken.length) throw new Error(`Required tools are missing or cannot start: ${broken.join(', ')}. Run \`yodaman setup\`.`);

    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-tools-smoke-'));
    try {
        fs.writeFileSync(path.join(workspace, 'index.js'), "const util = require('./util');\nmodule.exports = () => util.answer();\n");
        fs.writeFileSync(path.join(workspace, 'util.js'), 'module.exports = { answer: () => 42 };\n');
        await graphifyService.build(workspace, { update: true });
        const graph = JSON.parse(fs.readFileSync(graphifyService.graphPath(workspace), 'utf8'));
        const nodes = (graph.nodes || []).length;
        if (!nodes) throw new Error('Graphify built an empty graph for the sample project.');
        console.log(`ok   graph     ${nodes} nodes from a real Graphify build`);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
}

main().then(() => console.log('Tools smoke passed.'), (err) => {
    console.error(`Tools smoke FAILED: ${err.message}`);
    process.exit(1);
});
