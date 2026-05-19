const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const downloadsDir = path.join(rootDir, 'website', 'downloads');

const artifacts = [
    { name: 'YodaMan-0.1.7-arm64.dmg', dir: 'release' },
    { name: 'YodaMan-0.1.7-arm64-mac.zip', dir: 'release' },
    { name: 'YodaMan Setup 0.1.7.exe', dir: 'release' },
    { name: 'YodaMan-0.1.7-win.zip', dir: 'release' },
    { name: 'YodaMan-0.1.7.AppImage', dir: 'release' },
    { name: 'yodaman-0.1.7.zip', dir: 'release' },
    { name: 'vscode-yodaman-0.1.7.vsix', dir: path.join('extensions', 'vscode-yodaman') }
];

fs.mkdirSync(downloadsDir, { recursive: true });

for (const existing of fs.readdirSync(downloadsDir)) {
    if (/^(YodaMan|yodaman|vscode-yodaman).*0\.1\.7/.test(existing)) {
        fs.rmSync(path.join(downloadsDir, existing), { force: true });
    }
}

for (const artifact of artifacts) {
    const source = path.join(rootDir, artifact.dir, artifact.name);
    const destination = path.join(downloadsDir, artifact.name);

    if (!fs.existsSync(source)) {
        throw new Error(`Missing release artifact: ${source}`);
    }

    fs.copyFileSync(source, destination);
    const sizeMb = (fs.statSync(destination).size / 1024 / 1024).toFixed(1);
    console.log(`Copied ${artifact.name} to website/downloads (${sizeMb} MB)`);
}
