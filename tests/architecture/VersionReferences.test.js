/**
 * Every user-facing page names the release package.json names.
 *
 * public/manual.html said 0.6.4 for two releases while
 * `bump-version.js --check` passed, because the check only looked at the
 * sites someone had listed. It now also scans the docs for any version beside
 * "YodaMan" or "Version"; this keeps both halves honest.
 */
const { SITES, check, strayVersions } = require('../../scripts/bump-version');
const { version } = require('../../package.json');

test('the repository agrees with package.json', () => {
    expect(check(version)).toEqual([]);
});

test('the in-app manual and the VS Code publishing guide are bumped sites', () => {
    expect(SITES.map((s) => s.file)).toEqual(expect.arrayContaining(['public/manual.html', 'extensions/vscode-yodaman/PUBLISHING.md']));
});

test('the scan catches a page left on an older release', () => {
    // The shapes that drifted before, one each.
    expect(strayVersions('<p class="version">Version 0.6.4</p>', '0.6.6')).toEqual(['Version 0.6.4']);
    expect(strayVersions('(currently `vscode-yodaman-0.6.4.vsix`)', '0.6.6')).toEqual(['vscode-yodaman-0.6.4']);
    expect(strayVersions('YodaMan v0.4.4 integrates', '0.6.6')).toEqual(['YodaMan v0.4.4']);
    expect(strayVersions('Version: 0.6.6 and YodaMan 0.6.6', '0.6.6')).toEqual([]);
});

test('the website rewrite touches download links only, as its own rule says', () => {
    const site = SITES.find((s) => s.file === 'website/index.html');
    const page = '<a href="downloads/YodaMan-0.6.6-arm64.dmg">x</a> <p>New since 0.6.6</p>';
    expect(site.write(page, '0.6.6', '0.6.7')).toBe('<a href="downloads/YodaMan-0.6.7-arm64.dmg">x</a> <p>New since 0.6.6</p>');
});
