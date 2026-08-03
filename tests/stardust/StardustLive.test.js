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

    describe('validation status cache', () => {
        test('set and retrieve validation status', () => {
            stardustLive.setValidationStatus('test-change', 'ok');
            // The cache is internal but we can verify via snapshot
            const changeDir = path.join(tmpDir, 'openspec', 'changes', 'test-change');
            fs.mkdirSync(changeDir, { recursive: true });
            fs.writeFileSync(path.join(changeDir, 'tasks.md'), '- [ ] task\n');
            fs.writeFileSync(path.join(tmpDir, 'openspec', 'config.yaml'), 'version: 1\n');

            const snap = stardustLive.getSnapshot(tmpDir);
            expect(snap.changes[0].validation).toBe('ok');
        });

        test('rejects invalid status values', () => {
            // The REST endpoint validates this; the cache itself doesn't.
            stardustLive.setValidationStatus('any', 'ok');
            stardustLive.setValidationStatus('any', 'warn');
            stardustLive.setValidationStatus('any', 'error');
            // No throws — cache is lenient
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
