const { execSync, spawn } = require('child_process');

function checkDependencies() {
    console.log('🔍 Checking for Context Expert (ctx)...');
    try {
        execSync('ctx --version', { stdio: 'ignore' });
        console.log('✅ Context Expert is installed.');
    } catch (error) {
        console.error('❌ Error: "ctx" CLI is not installed or not in PATH.');
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
