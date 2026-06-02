#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');
const graphifyDoctor = require('../backend/infrastructure/GraphifyDoctor');

const args = process.argv.slice(2);

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

if (args[0] === 'doctor') {
    console.error('Usage: yodaman doctor --graph');
    process.exit(1);
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
