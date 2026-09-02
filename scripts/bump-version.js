#!/usr/bin/env node
/**
 * Move every version reference in the repository to a new version, in one step.
 *
 * WHY THIS EXISTS.
 *
 * The version lives in eleven places across three packages, a README badge, a
 * user manual, four docs, a website page, and an issue template. Every release
 * so far moved them by hand, and the ones that were missed are why
 * `tests/infrastructure/DocumentationAccuracy.test.js` had to be written: an
 * audit found docs claiming 0.4.4 four releases later, and a publishing guide
 * naming a `.vsix` nobody shipped.
 *
 * That test catches the rot. This prevents it.
 *
 *     node scripts/bump-version.js 0.5.6     # rewrite everything
 *     node scripts/bump-version.js --check   # verify, change nothing
 *
 * --check exits non-zero when anything disagrees with package.json, which is
 * the form a release gate can use.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH.
 *
 * `CHANGELOG.md` — history must keep naming the versions it describes.
 * Rewriting "## [0.5.5]" to "## [0.5.6]" would falsify the record, which is a
 * worse outcome than the drift this prevents. Add the new entry by hand.
 *
 * `packaging/homebrew/yodaman.rb` — its url and sha256 must match a tarball
 * that is actually published, so it is owned by `scripts/brew-formula.js` and
 * moves only AFTER `npm publish`. Bumping it here would point Homebrew at a
 * tarball that does not exist yet.
 *
 * A blanket search-and-replace of the version string across the tree would do
 * both of those wrong, which is why every edit below is anchored to a specific
 * pattern in a specific file.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/**
 * Every place a version lives.
 *
 * `find` is a function of the version so --check knows what SHOULD be there;
 * `replace` rewrites old to new. Anchored patterns, never a bare version match,
 * so a coincidental "0.5.5" in prose is not silently rewritten.
 */
const SITES = [
    {
        file: 'package.json',
        describe: 'npm package (core)',
        pattern: (v) => new RegExp(`("version":\\s*)"${escape(v)}"`),
        write: (s, from, to) => s.replace(new RegExp(`("version":\\s*)"${escape(from)}"`), `$1"${to}"`)
    },
    {
        file: 'extensions/vscode-yodaman/package.json',
        describe: 'VS Code extension',
        pattern: (v) => new RegExp(`("version":\\s*)"${escape(v)}"`),
        write: (s, from, to) => s.replace(new RegExp(`("version":\\s*)"${escape(from)}"`), `$1"${to}"`)
    },
    {
        // NOTE: apps/mobile/package.json carries its own independent version
        // (0.1.9) and is NOT bumped here. app.json is the one users see.
        file: 'apps/mobile/app.json',
        describe: 'mobile app (Expo)',
        pattern: (v) => new RegExp(`("version":\\s*)"${escape(v)}"`),
        write: (s, from, to) => s.replace(new RegExp(`("version":\\s*)"${escape(from)}"`), `$1"${to}"`)
    },
    {
        file: 'README.md',
        describe: 'README badge',
        pattern: (v) => new RegExp(`Version-${escape(v)}-gold`),
        write: (s, from, to) => s.replace(new RegExp(`Version-${escape(from)}-gold`, 'g'), `Version-${to}-gold`)
    },
    {
        file: 'user_manual.md',
        describe: 'user manual',
        pattern: (v) => new RegExp(`^Version:\\s*${escape(v)}`, 'm'),
        write: (s, from, to) => s
            .replace(new RegExp(`^Version:\\s*${escape(from)}`, 'm'), `Version: ${to}`)
            .replace(new RegExp(`YodaMan ${escape(from)}`, 'g'), `YodaMan ${to}`)
            // "mandatory in 0.5.5" — a statement about the CURRENT release, not
            // history, and missed by the two patterns above on the first run.
            .replace(new RegExp(`\\bin ${escape(from)}\\b`, 'g'), `in ${to}`)
    },
    {
        file: 'docs/architecture/architecture.md',
        describe: 'architecture doc',
        pattern: (v) => new RegExp(`YodaMan v${escape(v)}`),
        write: (s, from, to) => s.replace(new RegExp(`YodaMan v${escape(from)}`, 'g'), `YodaMan v${to}`)
    },
    {
        file: 'docs/guides/Management-Overview.md',
        describe: 'management overview',
        pattern: (v) => new RegExp(`\\(${escape(v)}\\)`),
        write: (s, from, to) => s
            .replace(new RegExp(`\\(${escape(from)}\\)`, 'g'), `(${to})`)
            .replace(new RegExp(`\\*\\*Version\\*\\*:\\s*${escape(from)}`, 'g'), `**Version**: ${to}`)
    },
    {
        file: 'docs/guides/setup.md',
        describe: 'setup guide',
        pattern: (v) => new RegExp(`YodaMan ${escape(v)}`),
        write: (s, from, to) => s.replace(new RegExp(`YodaMan ${escape(from)}`, 'g'), `YodaMan ${to}`)
    },
    {
        file: 'website/README.md',
        describe: 'website README',
        pattern: (v) => new RegExp(`\`${escape(v)}\``),
        write: (s, from, to) => s.replace(new RegExp(`\`${escape(from)}\``, 'g'), `\`${to}\``)
    },
    {
        // Download links name built artifacts. website/downloads/ is not
        // tracked, so these are dead until `npm run website:downloads` copies
        // the new build in — run that before deploying the site.
        file: 'website/index.html',
        describe: 'website download links',
        pattern: (v) => new RegExp(`downloads/[A-Za-z-]*${escape(v)}`),
        write: (s, from, to) => s.replace(new RegExp(escape(from), 'g'), to)
    },
    {
        file: '.github/ISSUE_TEMPLATE/bug_report.yml',
        describe: 'bug report placeholder',
        pattern: (v) => new RegExp(`placeholder:\\s*"${escape(v)}"`),
        write: (s, from, to) => s.replace(new RegExp(`placeholder:\\s*"${escape(from)}"`), `placeholder: "${to}"`)
    }
];

function escape(v) {
    return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function currentVersion() {
    return JSON.parse(read('package.json')).version;
}

function check(target) {
    const problems = [];
    for (const site of SITES) {
        if (!exists(site.file)) {
            // A missing file is a real finding: the site list has drifted from
            // the repository and something is no longer being bumped.
            problems.push(`${site.file} — listed here but not in the repository`);
            continue;
        }
        if (!site.pattern(target).test(read(site.file))) {
            problems.push(`${site.file} (${site.describe}) does not carry ${target}`);
        }
    }
    return problems;
}

function main() {
    const args = process.argv.slice(2);
    const checkOnly = args.includes('--check');
    const from = currentVersion();

    if (checkOnly) {
        const problems = check(from);
        if (!problems.length) {
            console.log(`All ${SITES.length} version references agree on ${from}.`);
            process.exit(0);
        }
        console.error(`Version drift against package.json (${from}):`);
        for (const p of problems) console.error(`  ${p}`);
        console.error('\nRun: node scripts/bump-version.js ' + from);
        process.exit(1);
    }

    const to = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
    if (!to) {
        console.error('Usage: node scripts/bump-version.js <version>   (or --check)');
        process.exit(1);
    }

    if (to === from) {
        console.log(`Already at ${to}. Checking consistency instead.`);
        const problems = check(to);
        problems.forEach((p) => console.error(`  ${p}`));
        process.exit(problems.length ? 1 : 0);
    }

    console.log(`${from} → ${to}\n`);
    let changed = 0;
    const untouched = [];

    for (const site of SITES) {
        if (!exists(site.file)) {
            untouched.push(`${site.file} (missing)`);
            continue;
        }
        const before = read(site.file);
        const after = site.write(before, from, to);
        if (after === before) {
            untouched.push(`${site.file} (no ${from} found)`);
            continue;
        }
        fs.writeFileSync(path.join(ROOT, site.file), after);
        console.log(`  ${site.file.padEnd(46)} ${site.describe}`);
        changed += 1;
    }

    console.log(`\n${changed} file(s) updated.`);

    if (untouched.length) {
        // Never silent. A site that did not match is either already correct or
        // quietly no longer being bumped, and the difference matters.
        console.log('\nNot changed — check these are intentional:');
        untouched.forEach((u) => console.log(`  ${u}`));
    }

    console.log('\nStill to do by hand:');
    console.log('  CHANGELOG.md            add the entry for this release');
    console.log('  packaging/homebrew      after `npm publish`, run: node scripts/brew-formula.js');
    console.log('  website/downloads/      run `npm run website:downloads` before deploying the site');
}

main();
