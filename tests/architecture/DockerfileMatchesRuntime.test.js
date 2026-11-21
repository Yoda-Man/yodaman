/**
 * The Docker image runs the Node and installs the tools the app itself requires.
 *
 * It was built on node:20 while package.json "engines" demands Node 24+, and it
 * installed @contextexpert/cli, which DependencyChecker.js records as crashing
 * on start, instead of yodaman-ctx with the install-script approvals it needs.
 */
const fs = require('fs');
const path = require('path');
const { SERVICES } = require('../../backend/infrastructure/DependencyChecker');

const ROOT = path.join(__dirname, '..', '..');
const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const engines = require('../../package.json').engines.node;

test('every FROM uses the Node major that "engines" requires', () => {
    const required = Number(/(\d+)/.exec(engines)[1]);
    const majors = [...dockerfile.matchAll(/^FROM\s+node:(\d+)/gm)].map((m) => Number(m[1]));
    expect(majors.length).toBeGreaterThan(0);
    expect(majors.every((major) => major === required)).toBe(true);
});

test.each(['ctx', 'openspec'])('installs %s with the command setup uses', (name) => {
    expect(dockerfile).toContain(SERVICES[name].installHint.linux);
});

test('never installs the abandoned @contextexpert/cli', () => {
    expect(dockerfile).not.toMatch(/@contextexpert\/cli/);
});
