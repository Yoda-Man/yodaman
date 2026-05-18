const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const downloadsDir = path.join(rootDir, 'website', 'downloads');

const artifacts = [
    'YodaMan-0.1.6-arm64.dmg',
    'YodaMan-0.1.6-arm64-mac.zip',
    'YodaMan Setup 0.1.6.exe',
    'YodaMan-0.1.6-win.zip',
    'YodaMan-0.1.6.AppImage',
    'yodaman-0.1.6.zip'
];

fs.mkdirSync(downloadsDir, { recursive: true });

for (const existing of fs.readdirSync(downloadsDir)) {
    if (/^(YodaMan|yodaman).*0\.1\.6/.test(existing)) {
        fs.rmSync(path.join(downloadsDir, existing), { force: true });
    }
}

for (const artifact of artifacts) {
    const source = path.join(rootDir, 'release', artifact);
    const destination = path.join(downloadsDir, artifact);

    if (!fs.existsSync(source)) {
        throw new Error(`Missing release artifact: ${source}`);
    }

    fs.copyFileSync(source, destination);
    const sizeMb = (fs.statSync(destination).size / 1024 / 1024).toFixed(1);
    console.log(`Copied ${artifact} to website/downloads (${sizeMb} MB)`);
}
