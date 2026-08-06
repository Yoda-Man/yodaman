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
        // Must match the version Graphify references. If Graphify starts
        // emitting a different version, update both this and the rewrite in
        // GraphifyService.localizeVendorScripts.
        version: '9.1.6'
    },
    { from: 'node_modules/vis-network/LICENSE-APACHE-2.0', to: 'vis-network.LICENSE.txt' }
];

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
            version: asset.version || null,
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
