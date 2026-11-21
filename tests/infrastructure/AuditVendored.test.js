/**
 * The vendored-library audit fails loudly on a level it does not know.
 *
 * VENDOR_AUDIT_LEVEL=hgih made the threshold undefined, every comparison false,
 * and the release gate pass without checking anything.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'audit-vendored.js');

test('an unknown VENDOR_AUDIT_LEVEL fails and names the valid ones', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
        env: { ...process.env, VENDOR_AUDIT_LEVEL: 'hgih' },
        encoding: 'utf8',
        timeout: 60000
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Unknown VENDOR_AUDIT_LEVEL "hgih"/);
    expect(result.stderr).toMatch(/info, low, moderate, high, critical/);
});
