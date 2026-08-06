/**
 * Logger file sink.
 *
 * The runbook has "Search Runtime Logs" and "Rotate local logs" sections, but
 * the runtime only ever wrote to stdout — which goes nowhere in the packaged
 * Electron app. These tests pin the sink that closes that gap.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Logger file sink', () => {
    let logDir;
    let logger;

    beforeEach(() => {
        logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-logs-'));
        process.env.YODAMAN_LOG_DIR = logDir;
        process.env.YODAMAN_LOG_TO_FILE = 'true';
        process.env.YODAMAN_LOG_MAX_BYTES = '2048';
        process.env.YODAMAN_LOG_MAX_FILES = '2';

        jest.resetModules();
        logger = require('../../backend/infrastructure/Logger');
    });

    afterEach(() => {
        delete process.env.YODAMAN_LOG_DIR;
        delete process.env.YODAMAN_LOG_TO_FILE;
        delete process.env.YODAMAN_LOG_MAX_BYTES;
        delete process.env.YODAMAN_LOG_MAX_FILES;
        fs.rmSync(logDir, { recursive: true, force: true });
    });

    test('writes structured JSON lines to disk', () => {
        logger.info('unit_test_event', { detail: 'hello' });

        const written = fs.readFileSync(logger.logFilePath(), 'utf8').trim().split('\n');
        const parsed = JSON.parse(written[written.length - 1]);

        expect(parsed.message).toBe('unit_test_event');
        expect(parsed.detail).toBe('hello');
        expect(parsed.level).toBe('info');
        expect(parsed.timestamp).toEqual(expect.any(String));
    });

    test('records errors with a serialized stack', () => {
        logger.error('unit_test_failure', new Error('boom'), { requestId: 'abc' });

        const lines = fs.readFileSync(logger.logFilePath(), 'utf8').trim().split('\n');
        const parsed = JSON.parse(lines[lines.length - 1]);

        expect(parsed.level).toBe('error');
        expect(parsed.error.message).toBe('boom');
        expect(parsed.error.stack).toContain('Error: boom');
        expect(parsed.requestId).toBe('abc');
    });

    test('rotates once the file exceeds the size limit, keeping a bounded set', () => {
        // 2 KB limit, ~200 bytes per line.
        for (let i = 0; i < 60; i += 1) {
            logger.info('filler_event', { index: i, padding: 'x'.repeat(150) });
        }

        expect(fs.existsSync(path.join(logDir, 'runtime.log'))).toBe(true);
        expect(fs.existsSync(path.join(logDir, 'runtime.log.1'))).toBe(true);

        // MAX_LOG_FILES=2, so .3 must never appear.
        expect(fs.existsSync(path.join(logDir, 'runtime.log.3'))).toBe(false);

        const live = fs.statSync(path.join(logDir, 'runtime.log')).size;
        expect(live).toBeLessThanOrEqual(2048);
    });

    test('an unwritable log directory disables the sink instead of crashing', () => {
        jest.resetModules();
        // A path under a regular file can never be created.
        const blocker = path.join(logDir, 'blocker');
        fs.writeFileSync(blocker, 'not a directory');
        process.env.YODAMAN_LOG_DIR = path.join(blocker, 'nested');

        const isolated = require('../../backend/infrastructure/Logger');
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => isolated.info('should_not_throw')).not.toThrow();
        expect(consoleError).toHaveBeenCalled();
        expect(consoleError.mock.calls[0][0]).toContain('log_file_sink_disabled');

        consoleError.mockRestore();
    });

    test('stays off under Jest unless explicitly enabled', () => {
        jest.resetModules();
        delete process.env.YODAMAN_LOG_TO_FILE;
        const quiet = require('../../backend/infrastructure/Logger');

        quiet.info('should_not_be_written');

        expect(fs.existsSync(quiet.logFilePath())).toBe(false);
    });
});
