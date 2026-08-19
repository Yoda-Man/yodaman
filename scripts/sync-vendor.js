#!/usr/bin/env node
/**
 * Copies vendored browser assets from node_modules into public/vendor/.
 *
 * WHY
 * ---
 * Graphify emits graph artifacts that load vis-network from unpkg:
 *
 *   <script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js">
 *
 * For a local-first product, rendering a graph should not require the public
 * internet or trust in a CDN's integrity. GraphifyService rewrites that tag to
 * point at /vendor/vis-network.min.js; this script puts the file there.
 *
 * The asset is copied from the pinned devDependency rather than downloaded, so
 * the version is recorded in package-lock.json and upgrading is `npm update`
 * plus a re-run of this script — not a hand-fetched blob that rots silently.
 *
 * Runs as part of `npm run build`.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const vendorDir = path.join(root, 'public', 'vendor');

const ASSETS = [
    {
        from: 'node_modules/vis-network/standalone/umd/vis-network.min.js',
        to: 'vis-network.min.js',
        // Read from the installed package rather than hardcoded. A literal here
        // silently went stale on the 9.1.6 -> 10.1.1 upgrade: the manifest kept
        // reporting 9.1.6 while shipping a different bundle, which is precisely
        // the record an audit would rely on. The rewrite in
        // GraphifyService.localizeVendorScripts matches vis-network@[\d.]+, so
        // it does not need to know the version.
        packageName: 'vis-network'
    },
    { from: 'node_modules/vis-network/LICENSE-APACHE-2.0', to: 'vis-network.LICENSE.txt' }
];

/** The version actually installed, so the manifest cannot drift from the bytes. */
function resolveVersion(asset) {
    if (!asset.packageName) return null;
    try {
        return require(`${asset.packageName}/package.json`).version;
    } catch (_err) {
        // The package is not installed, so there is no version to record. The
        // caller writes null into the manifest, which is honest.
        return null;
    }
}

function main() {
    fs.mkdirSync(vendorDir, { recursive: true });

    const manifest = [];
    for (const asset of ASSETS) {
        const source = path.join(root, asset.from);
        if (!fs.existsSync(source)) {
            console.error(`[sync-vendor] MISSING: ${asset.from}`);
            console.error('[sync-vendor] Run "npm install" first.');
            process.exit(1);
        }

        const target = path.join(vendorDir, asset.to);
        const bytes = fs.readFileSync(source);
        fs.writeFileSync(target, bytes);

        const sha = crypto.createHash('sha256').update(bytes).digest('hex');
        manifest.push({
            file: asset.to,
            source: asset.from,
            version: resolveVersion(asset) || null,
            bytes: bytes.length,
            sha256: sha
        });
        console.log(`[sync-vendor] ${asset.to} (${bytes.length} bytes)`);
    }

    fs.writeFileSync(
        path.join(vendorDir, 'MANIFEST.json'),
        `${JSON.stringify({ generatedBy: 'scripts/sync-vendor.js', assets: manifest }, null, 2)}\n`
    );
}

main();
