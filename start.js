const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function findGraphifyBinary() {
    if (process.env.YODAMAN_GRAPHIFY_BIN) return process.env.YODAMAN_GRAPHIFY_BIN;
    const pythonRoot = path.join(os.homedir(), 'Library', 'Python');
    if (fs.existsSync(pythonRoot)) {
        const userBin = fs.readdirSync(pythonRoot)
            .map(version => path.join(pythonRoot, version, 'bin', 'graphify'))
            .find(candidate => fs.existsSync(candidate));
        if (userBin) return userBin;
    }
    return 'graphify';
}

function checkDependencies() {
    console.log('🔍 Checking for Context Expert (ctx)...');
    try {
        execSync('ctx --version', { stdio: 'ignore' });
        console.log('✅ Context Expert is installed.');
    } catch (_error) {
        console.error('❌ Error: "ctx" CLI is not installed or not in PATH.');
        process.exit(1);
    }

    console.log('🔍 Checking for Graphify...');
    const graphifyBin = findGraphifyBinary();
    try {
        execSync(`"${graphifyBin}" --help`, { stdio: 'ignore' });
        console.log(`✅ Graphify is installed at ${graphifyBin}.`);
    } catch (_error) {
        console.error('❌ Error: "graphify" CLI is required and not in PATH.');
        console.error('Install it with: python3 -m pip install --user graphifyy');
        console.error('If it is installed outside PATH, set YODAMAN_GRAPHIFY_BIN to the graphify executable.');
        process.exit(1);
    }

    console.log('🔍 Checking for Ollama...');
    try {
        execSync('ollama --version', { stdio: 'ignore' });
        console.log('✅ Ollama is installed.');
    } catch (_error) {
        console.error('❌ Error: "ollama" CLI is required for local-only model execution.');
        process.exit(1);
    }
}

function startApp() {
    console.log('🚀 Starting GUI...');
    const child = spawn('npm', ['run', 'dev'], { 
        stdio: 'inherit',
        shell: true 
    });
    child.on('exit', (code) => process.exit(code || 0));
}

checkDependencies();
startApp();
