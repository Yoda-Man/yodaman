#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');

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
