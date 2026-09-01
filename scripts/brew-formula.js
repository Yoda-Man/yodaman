#!/usr/bin/env node
/**
 * Regenerate the Homebrew formula's url and sha256 from the published npm
 * tarball.
 *
 * WHY THIS IS A SCRIPT AND NOT A CHECKLIST ITEM.
 *
 * A Homebrew formula carries a version and a hash that must match a tarball on
 * a registry. Both are copied by hand at release time, and both are silent when
 * wrong: a stale url installs the previous version while claiming to be the new
 * one, and a stale sha256 fails at install time on a user's machine rather than
 * on ours. Neither is caught by anything we run.
 *
 * So it is derived instead. Run this after publishing to npm:
 *
 *     node scripts/brew-formula.js            # rewrite the formula
 *     node scripts/brew-formula.js --check    # verify without writing (CI)
 *
 * --check exits non-zero when the formula disagrees with what is published,
 * which is the form a release gate can use.
 *
 * IT READS THE REGISTRY, NOT THE LOCAL BUILD. The hash must describe the
 * artifact users will actually download. Hashing a local `npm pack` would
 * produce a number that is correct about a file nobody fetches.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const FORMULA = path.join(__dirname, '..', 'packaging', 'homebrew', 'yodaman.rb');
const pkg = require('../package.json');

/** Follow redirects; the registry issues them. */
function fetch(url, redirects = 5) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                if (redirects === 0) return reject(new Error('too many redirects'));
                res.resume();
                return resolve(fetch(res.headers.location, redirects - 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`${url} returned HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

async function main() {
    const check = process.argv.includes('--check');
    const version = pkg.version;
    const url = `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${version}.tgz`;

    process.stdout.write(`Fetching ${url}\n`);
    let tarball;
    try {
        tarball = await fetch(url);
    } catch (err) {
        // A version not yet published is a normal state between a version bump
        // and `npm publish`, so it must not read as corruption.
        console.error(`Could not fetch the published tarball: ${err.message}`);
        console.error(`If ${pkg.name}@${version} is not published yet, publish first, then run this.`);
        process.exit(check ? 1 : 2);
    }

    const sha256 = crypto.createHash('sha256').update(tarball).digest('hex');
    const source = fs.readFileSync(FORMULA, 'utf8');

    const updated = source
        .replace(/^(\s*url\s+)"[^"]*"/m, `$1"${url}"`)
        .replace(/^(\s*sha256\s+)"[^"]*"/m, `$1"${sha256}"`);

    if (check) {
        if (updated === source) {
            console.log(`Formula matches ${pkg.name}@${version} (sha256 ${sha256.slice(0, 12)}…)`);
            process.exit(0);
        }
        console.error(`Formula is out of date for ${pkg.name}@${version}.`);
        console.error('Run: node scripts/brew-formula.js');
        process.exit(1);
    }

    if (updated === source) {
        console.log('Formula already up to date; nothing written.');
        return;
    }

    fs.writeFileSync(FORMULA, updated);
    console.log(`Updated ${path.relative(process.cwd(), FORMULA)}`);
    console.log(`  version ${version}`);
    console.log(`  sha256  ${sha256}`);
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
