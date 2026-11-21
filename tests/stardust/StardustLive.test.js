// StardustLive tests — snapshot, deltas, and validation status
const path = require('path');
const fs = require('fs');
const os = require('os');

const stardustLive = require('../../backend/stardust/StardustLive');

describe('StardustLive', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardust-live-'));
    });

    afterEach(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('getSnapshot', () => {
        test('returns unready snapshot when no openspec dir exists', () => {
            const snap = stardustLive.getSnapshot(tmpDir);
            expect(snap.ready).toBe(false);
            expect(snap.changes).toEqual([]);
        });

        test('returns ready snapshot with empty changes when openspec exists but no changes', () => {
            fs.mkdirSync(path.join(tmpDir, 'openspec', 'changes'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'openspec', 'config.yaml'), 'version: 1\n');
            const snap = stardustLive.getSnapshot(tmpDir);
            expect(snap.ready).toBe(true);
            expect(snap.changes).toEqual([]);
        });

        test('detects changes and parses task progress', () => {
            const changesDir = path.join(tmpDir, 'openspec', 'changes', 'add-login');
            fs.mkdirSync(changesDir, { recursive: true });
            fs.writeFileSync(path.join(changesDir, 'tasks.md'), '- [x] Add login route\n- [ ] Add tests\n- [ ] Update docs\n');
            fs.writeFileSync(path.join(changesDir, 'proposal.md'), '# Proposal\n');
            fs.writeFileSync(path.join(tmpDir, 'openspec', 'config.yaml'), 'version: 1\n');

            const snap = stardustLive.getSnapshot(tmpDir);
            expect(snap.ready).toBe(true);
            expect(snap.changes).toHaveLength(1);
            expect(snap.changes[0].name).toBe('add-login');
            expect(snap.changes[0].taskTotal).toBe(3);
            expect(snap.changes[0].taskCompleted).toBe(1);
            expect(snap.changes[0].status).toBe('proposed');
        });

        test('graph status reflects graph freshness', () => {
            fs.mkdirSync(path.join(tmpDir, 'openspec', 'changes'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'openspec', 'config.yaml'), 'version: 1\n');

            // Create a graph that's old (> 1 hour)
            fs.mkdirSync(path.join(tmpDir, 'graphify-out'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'graphify-out', 'graph.json'), '{}');
            const past = new Date(Date.now() - 7200_000); // 2 hours ago
            fs.utimesSync(path.join(tmpDir, 'graphify-out', 'graph.json'), past, past);

            const snap = stardustLive.getSnapshot(tmpDir);
            expect(snap.graphStatus).toBe('stale');
        });

        test('sorts changes by mtime descending', () => {
            const base = path.join(tmpDir, 'openspec', 'changes');
            fs.mkdirSync(path.join(base, 'older'), { recursive: true });
            fs.mkdirSync(path.join(base, 'newer'), { recursive: true });
            fs.writeFileSync(path.join(base, 'older', 'tasks.md'), '- [ ] task\n');
            fs.writeFileSync(path.join(base, 'newer', 'tasks.md'), '- [ ] task\n');
            fs.writeFileSync(path.join(tmpDir, 'openspec', 'config.yaml'), 'version: 1\n');

            // Touch newer to be more recent
            const newerDir = path.join(base, 'newer');
            fs.utimesSync(newerDir, new Date(), new Date());

            const snap = stardustLive.getSnapshot(tmpDir);
            expect(snap.changes).toHaveLength(2);
            expect(snap.changes[0].name).toBe('newer');
        });
    });

    describe('getDeltas', () => {
        test('refuses a change name that leaves the changes folder', () => {
            fs.writeFileSync(path.join(fs.mkdirSync(path.join(tmpDir, 'openspec'), { recursive: true }), 'config.yaml'), 'version: 1\n');
            const outside = path.join(tmpDir, 'openspec', 'secret', 'specs');
            fs.mkdirSync(outside, { recursive: true });
            fs.writeFileSync(path.join(outside, 'x.md'), '## ADDED Requirements\n### Requirement: Hidden\nThe system SHALL hide.\n');

            expect(stardustLive.getDeltas(tmpDir, '../secret')).toEqual([]);
            expect(stardustLive.getDeltas(tmpDir, '..')).toEqual([]);
        });

        test('returns empty array when no change dir exists', () => {
            const deltas = stardustLive.getDeltas(tmpDir, 'nonexistent');
            expect(deltas).toEqual([]);
        });

        test('returns empty array when no spec deltas exist', () => {
            const changeDir = path.join(tmpDir, 'openspec', 'changes', 'simple');
            fs.mkdirSync(changeDir, { recursive: true });
            fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Simple change\n');
            fs.writeFileSync(path.join(tmpDir, 'openspec', 'config.yaml'), 'version: 1\n');

            const deltas = stardustLive.getDeltas(tmpDir, 'simple');
            expect(deltas).toEqual([]);
        });

        test('parses ADDED and MODIFIED requirement deltas', () => {
            const specsDir = path.join(tmpDir, 'openspec', 'changes', 'feature-x', 'specs');
            fs.mkdirSync(specsDir, { recursive: true });
            fs.writeFileSync(path.join(specsDir, 'auth.md'),
                '## ADDED Requirements\n\n' +
                '### Login endpoint\n' +
                'The system shall provide a POST /login endpoint.\n\n' +
                '## MODIFIED Requirements\n\n' +
                '### Session timeout\n' +
                'Session timeout changed from 30m to 60m.\n'
            );
            fs.writeFileSync(path.join(tmpDir, 'openspec', 'config.yaml'), 'version: 1\n');

            const deltas = stardustLive.getDeltas(tmpDir, 'feature-x');
            expect(deltas).toHaveLength(2);

            const added = deltas.filter(d => d.op === 'ADDED');
            expect(added).toHaveLength(1);
            expect(added[0].requirement).toBe('Login endpoint');
            expect(added[0].specId).toBe('auth');

            const modified = deltas.filter(d => d.op === 'MODIFIED');
            expect(modified).toHaveLength(1);
            expect(modified[0].requirement).toBe('Session timeout');
        });
    });

    describe('validation status and change status', () => {
        const addChange = (root, name, tasks) => {
            const changeDir = path.join(root, 'openspec', 'changes', name);
            fs.mkdirSync(changeDir, { recursive: true });
            fs.writeFileSync(path.join(changeDir, 'tasks.md'), tasks);
            fs.writeFileSync(path.join(root, 'openspec', 'config.yaml'), 'version: 1\n');
        };

        test('a validation result belongs to one workspace, not every change of that name', () => {
            const other = fs.mkdtempSync(path.join(os.tmpdir(), 'stardust-live-other-'));
            try {
                addChange(tmpDir, 'add-auth', '- [ ] task\n');
                addChange(other, 'add-auth', '- [ ] task\n');
                stardustLive.setValidationStatus(tmpDir, 'add-auth', 'ok');

                expect(stardustLive.getSnapshot(tmpDir).changes[0].validation).toBe('ok');
                expect(stardustLive.getSnapshot(other).changes[0].validation).toBe('unknown');
            } finally {
                fs.rmSync(other, { recursive: true, force: true });
            }
        });

        test('status follows validation and tasks instead of always reading proposed', () => {
            addChange(tmpDir, 'open', '- [x] one\n- [ ] two\n');
            addChange(tmpDir, 'checked', '- [x] one\n- [ ] two\n');
            addChange(tmpDir, 'done', '- [x] one\n- [X] two\n');
            stardustLive.setValidationStatus(tmpDir, 'checked', 'ok');

            const byName = Object.fromEntries(stardustLive.getSnapshot(tmpDir).changes.map(c => [c.name, c]));
            expect(byName.open.status).toBe('proposed');
            expect(byName.checked.status).toBe('validated');
            expect(byName.done.status).toBe('applied');
            // `[X]` counts towards the total as well as the done count.
            expect(byName.done).toMatchObject({ taskCompleted: 2, taskTotal: 2 });
        });

        test('the archive folder is not listed as a change', () => {
            addChange(tmpDir, 'live', '- [ ] task\n');
            fs.mkdirSync(path.join(tmpDir, 'openspec', 'changes', 'archive', '2026-01-01-old'), { recursive: true });

            expect(stardustLive.getSnapshot(tmpDir).changes.map(c => c.name)).toEqual(['live']);
        });
    });

    describe('allowUpgrade (the /api/stardust/live gates)', () => {
        const settings = require('../../backend/infrastructure/SettingsProvider');
        const pairingService = require('../../backend/infrastructure/PairingService');
        const upgrade = (remoteAddress, headers = {}) => ({ headers, socket: { remoteAddress } });

        beforeEach(() => {
            jest.spyOn(settings, 'get').mockImplementation((key) => key === 'requirePairingToken');
            jest.spyOn(pairingService, 'validate').mockImplementation((token) => token === 'good');
        });
        afterEach(() => jest.restoreAllMocks());

        test('lets the local UI in', () => {
            expect(stardustLive.allowUpgrade(upgrade('127.0.0.1', { origin: 'http://127.0.0.1:3090' }))).toBe(true);
            expect(stardustLive.allowUpgrade(upgrade('::1', { origin: 'http://localhost:5190' }))).toBe(true);
        });

        test('refuses a cross-site page, even over loopback', () => {
            expect(stardustLive.allowUpgrade(upgrade('127.0.0.1', { origin: 'https://evil.example' }))).toBe(false);
            expect(stardustLive.allowUpgrade(upgrade('127.0.0.1', { origin: 'null' }))).toBe(false);
            expect(stardustLive.allowUpgrade(upgrade('127.0.0.1', { 'sec-fetch-site': 'cross-site' }))).toBe(false);
        });

        test('asks another device for a valid pairing token', () => {
            expect(stardustLive.allowUpgrade(upgrade('192.168.1.30'))).toBe(false);
            expect(stardustLive.allowUpgrade(upgrade('192.168.1.30', { 'x-yodaman-token': 'bad' }))).toBe(false);
            expect(stardustLive.allowUpgrade(upgrade('192.168.1.30', { 'x-yodaman-token': 'good' }))).toBe(true);
        });
    });

    describe('findOpenSpecRoot', () => {
        test('finds openspec with config.yaml', () => {
            fs.mkdirSync(path.join(tmpDir, 'openspec'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'openspec', 'config.yaml'), 'version: 1\n');
            expect(stardustLive.findOpenSpecRoot(tmpDir)).toBe(path.join(tmpDir, 'openspec'));
        });

        test('returns null when no openspec exists', () => {
            expect(stardustLive.findOpenSpecRoot(tmpDir)).toBeNull();
        });
    });
});
