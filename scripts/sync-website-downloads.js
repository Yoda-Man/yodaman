const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const downloadsDir = path.join(rootDir, 'website', 'downloads');
const version = require(path.join(rootDir, 'package.json')).version;

// Holocron VR is a sibling repository on its own version line, and the website
// links its plugin zip alongside the YodaMan artifacts. It used to be copied in
// by hand, so when website/downloads was cleared the zip was simply gone and the
// download card 404'd with nothing to regenerate it. Read the version from the
// sibling checkout; if that checkout is absent (core cloned on its own) the
// artifact is reported missing and skipped like any other.
const holocronDir = path.resolve(rootDir, '..', 'Holocron VR');
let holocronVersion = null;
try {
    holocronVersion = require(path.join(holocronDir, 'package.json')).version;
} catch (_err) {
    console.warn('\x1b[33mWarning: Holocron VR checkout not found next to core. Skipping its plugin zip.\x1b[0m');
}

// Windows artifacts cross-built off a Windows host are not publishable. See the
// header of .github/workflows/release.yml: electron-builder needs Wine to run the
// NSIS packager, and the build can die mid-package leaving a truncated stub .exe
// that looks plausible and does not install. The website says we do not ship a
// Windows build from here — copying one into website/downloads would make that a
// lie, since the file is fetchable by URL whether or not a card links to it.
const isWindowsHost = process.platform === 'win32';

const artifacts = [
    { name: `YodaMan-${version}-arm64.dmg`, dir: 'release' },
    { name: `YodaMan-${version}-arm64-mac.zip`, dir: 'release' },
    { name: `YodaMan Setup ${version}.exe`, dir: 'release', windowsOnly: true },
    { name: `YodaMan-${version}-win.zip`, dir: 'release', windowsOnly: true },
    { name: `YodaMan-${version}.AppImage`, dir: 'release' },
    { name: `yodaman-${version}.zip`, dir: 'release' },
    { name: `vscode-yodaman-${version}.vsix`, dir: path.join('extensions', 'vscode-yodaman') }
];

if (holocronVersion) {
    artifacts.push({ name: `holocron-vr-${holocronVersion}.zip`, absoluteDir: holocronDir });
}

fs.mkdirSync(downloadsDir, { recursive: true });

for (const existing of fs.readdirSync(downloadsDir)) {
    if (/^(YodaMan|yodaman|vscode-yodaman|holocron-vr)/.test(existing)) {
        fs.rmSync(path.join(downloadsDir, existing), { force: true });
    }
}

for (const artifact of artifacts) {
    const source = artifact.absoluteDir
        ? path.join(artifact.absoluteDir, artifact.name)
        : path.join(rootDir, artifact.dir, artifact.name);
    const destination = path.join(downloadsDir, artifact.name);

    if (artifact.windowsOnly && !isWindowsHost) {
        console.warn(
            `\x1b[33mSkipping ${artifact.name}: cross-built on ${process.platform}, not publishable. ` +
            `Build it on a native Windows runner via .github/workflows/release.yml.\x1b[0m`
        );
        continue;
    }

    if (!fs.existsSync(source)) {
        console.warn(`\x1b[33mWarning: Missing release artifact: ${source}. Skipping...\x1b[0m`);
        continue;
    }

    fs.copyFileSync(source, destination);
    const sizeMb = (fs.statSync(destination).size / 1024 / 1024).toFixed(1);
    console.log(`Copied ${artifact.name} to website/downloads (${sizeMb} MB)`);
}
