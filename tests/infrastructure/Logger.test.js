const logger = require('../../backend/infrastructure/Logger');

describe('Logger diagnostics', () => {
    beforeEach(() => {
        logger.clear();
    });

    afterEach(() => {
        logger.clear();
    });

    test('captures structured errors with stack, severity, request, and user action context', () => {
        const error = new Error('ctx search unavailable');
        logger.error('search_failed', error, {
            requestId: 'req-1',
            userAction: 'code_search',
            severity: 'high',
            project: '/tmp/Anchor'
        });

        const [entry] = logger.list();
        expect(entry).toEqual(expect.objectContaining({
            level: 'error',
            message: 'search_failed',
            requestId: 'req-1',
            userAction: 'code_search',
            severity: 'high',
            project: '/tmp/Anchor',
            error: expect.objectContaining({
                name: 'Error',
                message: 'ctx search unavailable',
                stack: expect.stringContaining('ctx search unavailable')
            })
        }));
    });

    test('clearFiles deletes runtime.log and its rotated copies, and nothing else', () => {
        const fs = require('fs');
        const path = require('path');
        const dir = logger.logDirectory();
        fs.mkdirSync(dir, { recursive: true });
        const logs = ['runtime.log', 'runtime.log.1', 'runtime.log.2', 'runtime.log.3'];
        for (const name of [...logs, 'keep.txt']) fs.writeFileSync(path.join(dir, name), 'x');

        logger.clearFiles();

        for (const name of logs) expect(fs.existsSync(path.join(dir, name))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'keep.txt'))).toBe(true);
        fs.rmSync(path.join(dir, 'keep.txt'));
        expect(() => logger.clearFiles()).not.toThrow(); // nothing left to delete is fine
    });

    test('filters logs by level, message query, user action, and time range', () => {
        logger.info('startup_completed', { userAction: 'startup' });
        const since = new Date(Date.now() - 1000).toISOString();
        logger.error('search_failed', new Error('ctx search unavailable'), {
            userAction: 'code_search',
            severity: 'high'
        });
        logger.warn('agent_tool_rejected', { userAction: 'agent_tool_call' });

        const results = logger.list(50, {
            level: 'error',
            query: 'ctx search',
            userAction: 'code_search',
            severity: 'high',
            since
        });

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual(expect.objectContaining({
            level: 'error',
            message: 'search_failed',
            userAction: 'code_search',
            severity: 'high'
        }));
    });
});
