const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const downloadsDir = path.join(rootDir, 'website', 'downloads');

const artifactPatterns = [
    /^YodaMan-0\.1\.6.*\.(dmg|zip|exe|AppImage|deb|rpm)$/i
];

fs.mkdirSync(downloadsDir, { recursive: true });

const artifacts = fs.readdirSync(path.join(rootDir, 'release'))
    .filter((name) => artifactPatterns.some((pattern) => pattern.test(name)))
    .sort();

if (artifacts.length === 0) {
    throw new Error('No desktop release artifacts found in release/. Run npm run desktop:dist first.');
}

for (const artifact of artifacts) {
    const source = path.join(rootDir, 'release', artifact);
    const destination = path.join(downloadsDir, artifact);

    fs.copyFileSync(source, destination);
    const sizeMb = (fs.statSync(destination).size / 1024 / 1024).toFixed(1);
    console.log(`Copied ${artifact} to website/downloads (${sizeMb} MB)`);
}
