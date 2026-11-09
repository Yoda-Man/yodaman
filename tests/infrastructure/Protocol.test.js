const fs = require('fs');
const path = require('path');
const { generate } = require('../../scripts/generate-protocol');

describe('Protocol Generation Consistency', () => {
    it('should have up-to-date generated protocol files matching the schema', () => {
        const rootDir = path.resolve(__dirname, '../..');
        const jsPath = path.join(rootDir, 'shared', 'yodamanProtocol.js');
        const tsPath = path.join(rootDir, 'shared', 'yodamanProtocol.d.ts');

        const originalJs = fs.readFileSync(jsPath, 'utf8');
        const originalTs = fs.readFileSync(tsPath, 'utf8');

        // Run the generator
        generate();

        const newJs = fs.readFileSync(jsPath, 'utf8');
        const newTs = fs.readFileSync(tsPath, 'utf8');

        // Restore if different to avoid dirtying git during test runs if something went wrong
        if (originalJs !== newJs) {
            fs.writeFileSync(jsPath, originalJs, 'utf8');
        }
        if (originalTs !== newTs) {
            fs.writeFileSync(tsPath, originalTs, 'utf8');
        }

        expect(newJs).toBe(originalJs);
        expect(newTs).toBe(originalTs);
    });

    it('declares every task event the runtime emits, so clients do not throw on one', () => {
        // shared/yodamanClient.js asserts each streamed event against this list;
        // upload_error and response_truncated were emitted but missing from it.
        const { TASK_EVENT_TYPES } = require('../../shared/yodamanProtocol');
        const root = path.resolve(__dirname, '../..');
        const emitted = new Set();
        for (const file of ['backend/core/AgentReasoningEngine.js', 'backend/interfaces/RestController.js']) {
            const source = fs.readFileSync(path.join(root, file), 'utf8');
            for (const m of source.matchAll(/(?:sendEvent|emit|onStep|recordTaskEvent)\([^)]*?type: '([a-z_]+)'|\{ type: '([a-z_]+)', taskId/g)) emitted.add(m[1] || m[2]);
        }
        expect(emitted.size).toBeGreaterThan(5);
        expect([...emitted].filter((type) => !Object.values(TASK_EVENT_TYPES).includes(type))).toEqual([]);
    });
});
