/**
 * Audit the libraries that scripts/sync-vendor.js copies into public/vendor/.
 *
 * These are devDependencies, so `npm audit --omit=dev` does not see them — but
 * public/ ships in both the npm tarball ("files" in package.json) and the
 * desktop app (electron-builder.json). A vulnerable vis-network bundle shipped
 * to users for months while the CI audit gate reported "0 vulnerabilities".
 *
 * Exits non-zero when a vendored package has an advisory at or above the
 * threshold, so the gap cannot silently reopen.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MANIFEST = path.join(__dirname, '..', 'public', 'vendor', 'MANIFEST.json');
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const THRESHOLD = RANK[process.env.VENDOR_AUDIT_LEVEL || 'moderate'];

function vendoredPackages() {
    if (!fs.existsSync(MANIFEST)) {
        console.error(`No ${path.relative(process.cwd(), MANIFEST)}. Run "npm run vendor:sync" first.`);
        process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    // The manifest records the source path each asset was copied from; the
    // package name is the segment straight after node_modules/.
    const names = new Set();
    for (const asset of manifest.assets || []) {
        const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(asset.source || '');
        if (match) names.add(match[1]);
    }
    return { names: [...names], manifest };
}

function main() {
    const { names, manifest } = vendoredPackages();
    if (!names.length) {
        console.log('No vendored packages recorded — nothing to audit.');
        return;
    }

    let report;
    try {
        report = JSON.parse(execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch (err) {
        // npm audit exits non-zero whenever it finds anything at all, so a
        // non-zero exit is expected and the payload is still on stdout.
        try {
            report = JSON.parse(err.stdout || '{}');
        } catch (_parseErr) {
            console.error('Could not parse npm audit output.');
            process.exit(1);
        }
    }

    const vulns = report.vulnerabilities || {};
    const offending = names
        .filter((name) => vulns[name] && RANK[vulns[name].severity] >= THRESHOLD)
        .map((name) => ({ name, severity: vulns[name].severity, range: vulns[name].range }));

    for (const asset of manifest.assets || []) {
        if (asset.version) console.log(`  vendored  ${asset.file} @ ${asset.version}`);
    }

    if (!offending.length) {
        console.log(`Vendored libraries clean at "${process.env.VENDOR_AUDIT_LEVEL || 'moderate'}" and above.`);
        return;
    }

    console.error('\nVendored libraries ship to users and have advisories:');
    for (const o of offending) {
        console.error(`  ${o.name}: ${o.severity} (affected ${o.range})`);
    }
    console.error('\nUpgrade the package, then run "npm run vendor:sync".');
    process.exit(1);
}

main();
