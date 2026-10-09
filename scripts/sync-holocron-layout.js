#!/usr/bin/env node
/**
 * Copy Holocron's compiled layout engine into public/vendor/holocron-layout/.
 *
 * The engine is C++ compiled to WebAssembly in the Holocron VR repository
 * (`npm run build:wasm` there). Core's CI checks out core alone and has no
 * Emscripten, so the compiled files are committed here, like vis-network, and
 * refreshed with this script whenever Holocron's engine changes:
 *
 *     npm run vendor:holocron                       # copy from ../Holocron VR
 *     node scripts/sync-holocron-layout.js --check  # verify, write nothing
 *
 * MANIFEST.json records each file's size and sha256 plus the Holocron version
 * and commit they came from, so what ships can be traced to source.
 * tests/frontend/HolocronLayout.test.js fails if the bytes and the manifest
 * disagree, or if the vendored copy has drifted from a Holocron checkout
 * beside core.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const holocron = path.join(root, '..', 'Holocron VR');
const target = path.join(root, 'public', 'vendor', 'holocron-layout');
const FILES = ['layout_engine.mjs', 'layout_engine.wasm', 'bindLayoutEngine.js'];

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function holocronCommit() {
    try {
        return execFileSync('git', ['-C', holocron, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch (_err) {
        // Not a git checkout (a release zip, say). The version still identifies it.
        return null;
    }
}

function main() {
    const check = process.argv.includes('--check');
    const source = path.join(holocron, 'frontend');
    const missing = FILES.filter((file) => !fs.existsSync(path.join(source, file)));
    if (missing.length) {
        console.error(`[sync-holocron-layout] Missing in ${source}: ${missing.join(', ')}`);
        console.error('[sync-holocron-layout] Build the engine there first: npm run build:wasm');
        process.exit(1);
    }

    const files = FILES.map((file) => {
        const bytes = fs.readFileSync(path.join(source, file));
        return { file, bytes: bytes.length, sha256: sha256(bytes), data: bytes };
    });

    if (check) {
        const stale = files.filter(({ file, sha256: expected }) => {
            const vendored = path.join(target, file);
            return !fs.existsSync(vendored) || sha256(fs.readFileSync(vendored)) !== expected;
        });
        if (stale.length) {
            console.error(`[sync-holocron-layout] Out of date: ${stale.map((f) => f.file).join(', ')}. Run: node scripts/sync-holocron-layout.js`);
            process.exit(1);
        }
        console.log('[sync-holocron-layout] Vendored engine matches Holocron.');
        return;
    }

    fs.mkdirSync(target, { recursive: true });
    for (const { file, data } of files) fs.writeFileSync(path.join(target, file), data);
    const manifest = {
        generatedBy: 'scripts/sync-holocron-layout.js',
        holocronVersion: require(path.join(holocron, 'package.json')).version,
        holocronCommit: holocronCommit(),
        files: files.map(({ file, bytes, sha256: hash }) => ({ file, bytes, sha256: hash }))
    };
    fs.writeFileSync(path.join(target, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const { file, bytes } of files) console.log(`[sync-holocron-layout] ${file} (${bytes} bytes)`);
}

main();
