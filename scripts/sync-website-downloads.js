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

const copied = [];

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
    copied.push(artifact.name);
    const sizeMb = (fs.statSync(destination).size / 1024 / 1024).toFixed(1);
    console.log(`Copied ${artifact.name} to website/downloads (${sizeMb} MB)`);
}

/**
 * Point the download buttons at what was just copied.
 *
 * The files were synced but index.html was hand-edited, so every release the
 * site kept advertising the previous version's filenames — links that 404 the
 * moment the old artifacts are cleaned up. Copying a file and leaving the link
 * behind is not a sync.
 *
 * Rewrites only hrefs under downloads/ whose filename differs from the copied
 * artifact by version alone, so an unrelated link is never touched.
 */
const indexPath = path.join(rootDir, 'website', 'index.html');
if (copied.length && fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, 'utf8');
    let rewrites = 0;

    for (const name of copied) {
        // Split the artifact name into the part before the version and the part
        // after, then match any version between them.
        const match = /^(.*?)(\d+\.\d+\.\d+)(.*)$/.exec(name);
        if (!match) continue;
        const [, prefix, , suffix] = match;
        const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(
            `downloads/${escape(prefix)}\\d+\\.\\d+\\.\\d+${escape(suffix)}`,
            'g'
        );
        html = html.replace(pattern, (found) => {
            if (found !== `downloads/${name}`) rewrites += 1;
            return `downloads/${name}`;
        });
    }

    if (rewrites) {
        fs.writeFileSync(indexPath, html, 'utf8');
        console.log(`Updated ${rewrites} download link(s) in website/index.html`);
    }
}
