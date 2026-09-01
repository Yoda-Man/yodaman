#!/usr/bin/env node

/**
 * LOAD-BEARING — DO NOT DELETE BECAUSE "NOTHING IMPORTS IT".
 *
 * CLI entry point. Reached via the "bin" field in package.json ("yodaman"),
 * so npm/npx resolves it by name and nothing in this repo imports it.
 *
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const graphifyDoctor = require('../backend/infrastructure/GraphifyDoctor');
const dependencyDoctor = require('../backend/infrastructure/DependencyDoctor');

const args = process.argv.slice(2);

// ─── help / version ────────────────────────────────────────────────────
// Deliberately before every other require below runs any real work: `yodaman
// --help` used to fall through this file entirely and BOOT THE RUNTIME, so a
// user asking what the commands were got a server instead of an answer.
if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    const { version } = require('../package.json');
    console.log(`
YodaMan ${version} — local-first workspace intelligence

  yodaman                    Start the runtime (http://localhost:3090)
  yodaman setup              Install the dependencies YodaMan needs
  yodaman doctor             Check dependency health
  yodaman doctor --graph     Check knowledge-graph health
  yodaman create-plugin <n>  Scaffold a new plugin

Options
  --help, -h                 Show this
  --version, -v              Show the version

Setup
  yodaman setup --dry-run    Show what would be installed, change nothing
  yodaman setup --yes        Install without prompting

Docs: https://github.com/Yoda-Man/yodaman
`.trim());
    process.exit(0);
}

if (args[0] === '--version' || args[0] === '-v' || args[0] === 'version') {
    console.log(require('../package.json').version);
    process.exit(0);
}

// ─── setup — install the dependencies YodaMan needs ────────────────────
if (args[0] === 'setup' || args[0] === 'install') {
    const { execSync } = require('child_process');
    const dependencyChecker = require('../backend/infrastructure/DependencyChecker');
    const setupPlanner = require('../backend/infrastructure/SetupPlanner');

    const dryRun = args.includes('--dry-run');
    const assumeYes = args.includes('--yes') || args.includes('-y');

    (async () => {
        console.log('Checking what YodaMan needs...\n');
        const checks = await dependencyChecker.checkAll();
        const plan = setupPlanner.buildSetupPlan({ checks });

        console.log(setupPlanner.formatSetupPlan(plan));

        if (plan.ok) process.exit(0);
        if (!plan.automatic.length) {
            // Manual steps only. Nothing to run, but this is not success —
            // YodaMan still cannot work until they are done.
            process.exit(1);
        }
        if (dryRun) {
            console.log('Dry run — nothing was installed.');
            process.exit(0);
        }

        if (!assumeYes) {
            const readline = require('readline');
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const answer = await new Promise((resolve) => {
                rl.question(`Run ${plan.automatic.length} command(s)? [y/N] `, (a) => { rl.close(); resolve(a); });
            });
            if (!/^y(es)?$/i.test(answer.trim())) {
                console.log('Nothing was installed.');
                process.exit(0);
            }
            console.log('');
        }

        const failed = [];
        for (const step of plan.automatic) {
            console.log(`→ ${step.command}`);
            try {
                execSync(step.command, { stdio: 'inherit' });
            } catch (err) {
                // Keep going: one failing package manager should not block the
                // other two. Every failure is reported at the end.
                failed.push({ name: step.name, command: step.command });
                console.error(`  ${step.name} failed — see the output above.`);
            }
        }

        // Re-check rather than trusting the exit codes. A package manager can
        // exit 0 and still leave nothing on PATH, and "it said it worked" is
        // not evidence that it did.
        console.log('\nVerifying...');
        dependencyChecker.resetCtxModelCache?.();
        const after = await dependencyChecker.checkAll();
        const stillMissing = Object.keys(after).filter((n) => !after[n].found);

        if (stillMissing.length === 0) {
            console.log('All dependencies are installed. Run `yodaman` to start.');
            process.exit(0);
        }

        console.log(`Still missing: ${stillMissing.join(', ')}`);
        console.log('Run `yodaman doctor` for detail.');
        // Ollama being absent is expected here — it is never auto-installed —
        // so only a failed automatic step is an error.
        process.exit(failed.length ? 1 : 0);
    })().catch((err) => {
        console.error(`Setup failed: ${err.message}`);
        process.exit(1);
    });
    return;
}

// ─── create-plugin command ─────────────────────────────────────────────
if (args[0] === 'create-plugin') {
    const pluginName = args[1];
    if (!pluginName) {
        console.error('Usage: yodaman create-plugin <plugin-name>');
        process.exit(1);
    }

    const pluginsDir = path.join(__dirname, '..', 'plugins');
    const targetFile = path.join(pluginsDir, `${pluginName}.js`);
    const testFile = path.join(pluginsDir, `${pluginName}.test.js`);
    const readmeFile = path.join(pluginsDir, 'README.md');

    if (fs.existsSync(targetFile)) {
        console.error(`Plugin "${pluginName}" already exists at ${targetFile}`);
        process.exit(1);
    }

    // Generate plugin source
    const pluginSource = `/**
 * YodaMan Plugin: ${pluginName}
 * 
 * ${pluginName.replace(/[-_]/g, ' ')} — auto-generated plugin scaffold.
 * 
 * Parameters, permissions, and description should be updated to match
 * the actual tool functionality before use.
 */
module.exports = {
    name: '${pluginName}',
    description: '${pluginName.replace(/[-_]/g, ' ')} — describe what this tool does.',
    permissions: ['read'],
    parameters: {
        target: 'Describe the first parameter'
    },
    async execute(parameters = {}) {
        const { target } = parameters;
        if (!target) throw new Error('target is required');
        return {
            message: module.exports.name + ' executed on "' + target + '"',
            result: null
        };
    }
};
`;

    // Generate test file
    const testSource = `const ${pluginName.replace(/-/g, '_')} = require('./${pluginName}');

describe('${pluginName} plugin', () => {
    it('should export name, description, permissions, parameters, and execute', () => {
        expect(${pluginName.replace(/-/g, '_')}.name).toBe('${pluginName}');
        expect(typeof ${pluginName.replace(/-/g, '_')}.description).toBe('string');
        expect(Array.isArray(${pluginName.replace(/-/g, '_')}.permissions)).toBe(true);
        expect(typeof ${pluginName.replace(/-/g, '_')}.parameters).toBe('object');
        expect(typeof ${pluginName.replace(/-/g, '_')}.execute).toBe('function');
    });

    it('should throw on missing required parameters', async () => {
        await expect(${pluginName.replace(/-/g, '_')}.execute({})).rejects.toThrow('target is required');
    });

    it('should execute with valid parameters', async () => {
        const result = await ${pluginName.replace(/-/g, '_')}.execute({ target: 'test' });
        expect(result.message).toContain('test');
    });
});
`;

    // Generate README entry
    let readmeContent;
    if (fs.existsSync(readmeFile)) {
        readmeContent = fs.readFileSync(readmeFile, 'utf8');
    } else {
        readmeContent = '# YodaMan Plugin API Reference\n\n';
    }

    const pluginEntry = [
        '',
        `## ${pluginName}`,
        '',
        `${pluginName.replace(/[-_]/g, ' ')} — auto-generated plugin.`,
        '',
        '### Parameters',
        '',
        '| Parameter | Type | Required | Description |',
        '|-----------|------|----------|-------------|',
        '| `target`  | string | yes | Describe the first parameter |',
        '',
        '### Permissions',
        '',
        '`read`',
        '',
        '### Example',
        '',
        '```json',
        '{',
        `  "name": "${pluginName}",`,
        '  "parameters": { "target": "example-value" }',
        '}',
        '```',
        ''
    ].join('\n');

    // Write files
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(targetFile, pluginSource, 'utf8');
    console.log(`✅ Created plugin source: ${targetFile}`);

    fs.writeFileSync(testFile, testSource, 'utf8');
    console.log(`✅ Created test file: ${testFile}`);

    // Append or update README
    if (readmeContent.includes(`## ${pluginName}`)) {
        // Update existing entry — simple replace
        console.log(`ℹ️  README entry for "${pluginName}" already exists — not modified.`);
    } else {
        fs.writeFileSync(readmeFile, readmeContent + pluginEntry, 'utf8');
        console.log(`✅ Updated plugin README: ${readmeFile}`);
    }

    // Auto-register in config.json
    const cwdConfigPath = path.join(process.cwd(), 'config.json');
    const pkgConfigPath = path.join(__dirname, '..', 'config.json');
    const configPath = fs.existsSync(cwdConfigPath) ? cwdConfigPath : pkgConfigPath;

    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (!config.plugins) config.plugins = {};
            if (!config.plugins[pluginName]) {
                config.plugins[pluginName] = { enabled: true };
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
                console.log(`✅ Registered "${pluginName}" in ${configPath}`);
            } else {
                console.log(`ℹ️  "${pluginName}" already registered in config.json`);
            }
        } catch (err) {
            console.log(`⚠️  Could not register in config.json: ${err.message}`);
        }
    } else {
        console.log(`ℹ️  No config.json found — skipping auto-registration.`);
    }

    console.log('');
    console.log('📦 Plugin scaffold complete. Next steps:');
    console.log(`   1. Edit ${targetFile} to implement your tool logic`);
    console.log(`   2. Update parameters, description, and permissions`);
    console.log(`   3. Run tests: npx jest ${testFile}`);
    console.log(`   4. Start YodaMan to load the plugin`);
    process.exit(0);
}

if (args[0] === 'doctor' && args.includes('--graph')) {
    try {
        const cwdConfigPath = path.join(process.cwd(), 'config.json');
        const packageConfigPath = path.join(__dirname, '..', 'config.json');
        const configPath = require('fs').existsSync(cwdConfigPath) ? cwdConfigPath : packageConfigPath;
        const report = graphifyDoctor.runGraphDoctor({ configPath });
        console.log(graphifyDoctor.formatGraphDoctorReport(report));
        process.exit(report.activeProjects === 0 ? 1 : 0);
    } catch (err) {
        console.error(`Graphify health check failed: ${err.message}`);
        process.exit(1);
    }
}

// ─── doctor (no flags) — required runtime dependency health ────────────
// Checks the same dependency set the runtime validates at startup:
// Ollama, Context Expert (ctx), Graphify, and OpenSpec.
if (args[0] === 'doctor') {
    const asJson = args.includes('--json');

    dependencyDoctor.runDependencyDoctor()
        .then(report => {
            if (asJson) {
                console.log(JSON.stringify(report, null, 2));
            } else {
                console.log(dependencyDoctor.formatDependencyReport(report));
            }
            process.exit(report.ok ? 0 : 1);
        })
        .catch(err => {
            console.error(`Dependency health check failed: ${err.message}`);
            process.exit(1);
        });
    return;
}

// The main server file is in the parent directory of this script
const serverPath = path.join(__dirname, '..', 'server.js');

console.log('🚀 Starting YodaMan...');

const server = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }
});

server.on('exit', (code) => {
    process.exit(code || 0);
});
