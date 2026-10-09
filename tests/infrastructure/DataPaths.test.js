/**
 * config.json and yodaman.db live in the user's data folder, outside the
 * install, so upgrading YodaMan never erases them.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const dataPaths = require('../../backend/infrastructure/DataPaths');

function scratch() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-datapaths-'));
}

describe('where the data lives', () => {
    test('the per-user application data folder on each platform, the one Electron uses', () => {
        expect(dataPaths.defaultDataDir({ platform: 'darwin', env: {}, home: '/Users/rey' }))
            .toBe(path.join('/Users/rey', 'Library', 'Application Support', 'YodaMan'));
        expect(dataPaths.defaultDataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\rey\\AppData\\Roaming' }, home: 'C:\\Users\\rey' }))
            .toBe(path.join('C:\\Users\\rey\\AppData\\Roaming', 'YodaMan'));
        expect(dataPaths.defaultDataDir({ platform: 'linux', env: {}, home: '/home/rey' })).toBe(path.join('/home/rey', '.config', 'YodaMan'));
        expect(dataPaths.defaultDataDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, home: '/home/rey' })).toBe(path.join('/xdg', 'YodaMan'));
    });

    test('never inside the install, which an upgrade replaces', () => {
        for (const platform of ['darwin', 'win32', 'linux']) {
            const dir = dataPaths.defaultDataDir({ platform, env: {}, home: os.homedir() });
            expect(path.relative(dataPaths.INSTALL_ROOT, dir).startsWith('..')).toBe(true);
        }
    });

    test('YODAMAN_DATA_DIR moves the folder; the single-file overrides still win', () => {
        const env = { YODAMAN_DATA_DIR: '/data' };
        expect(dataPaths.configPath(env)).toBe(path.resolve('/data', 'config.json'));
        expect(dataPaths.databasePath(env)).toBe(path.resolve('/data', 'yodaman.db'));
        expect(dataPaths.configPath({ ...env, YODAMAN_CONFIG_PATH: '/x/c.json' })).toBe('/x/c.json');
        expect(dataPaths.databasePath({ ...env, YODAMAN_DB_PATH: '/x/y.db' })).toBe('/x/y.db');
    });

    test('this suite never points at the real data folder', () => {
        expect(dataPaths.dataDir()).not.toBe(dataPaths.defaultDataDir());
        expect(dataPaths.dataDir().startsWith(os.tmpdir())).toBe(true);
    });
});

describe('bringing data over from an older install', () => {
    function oldInstall() {
        const from = scratch();
        fs.writeFileSync(path.join(from, 'config.json'), JSON.stringify({ watchedDirectories: ['/work/coruscant'] }));
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(path.join(from, 'yodaman.db'));
        db.exec("PRAGMA journal_mode=WAL; CREATE TABLE tasks (taskId TEXT); INSERT INTO tasks VALUES ('order-66');");
        // Left open on purpose: the row sits in the -wal file, as it does while
        // an older runtime is still running. A plain file copy would lose it.
        return { from, db };
    }

    test('copies both files, including database rows not yet checkpointed', () => {
        const { from, db } = oldInstall();
        const env = { YODAMAN_DATA_DIR: scratch() };
        const result = dataPaths.prepareDataDir({ from, env });
        db.close();

        expect(result).toEqual({ copied: ['config.json', 'yodaman.db'], failed: [] });
        expect(JSON.parse(fs.readFileSync(dataPaths.configPath(env), 'utf8')).watchedDirectories).toEqual(['/work/coruscant']);
        const { DatabaseSync } = require('node:sqlite');
        const copy = new DatabaseSync(dataPaths.databasePath(env));
        expect(copy.prepare('SELECT taskId FROM tasks').all().map((r) => r.taskId)).toEqual(['order-66']);
        copy.close();
    });

    test('copies, never moves: an older version run again still finds its data', () => {
        const { from, db } = oldInstall();
        db.close();
        dataPaths.prepareDataDir({ from, env: { YODAMAN_DATA_DIR: scratch() } });
        expect(fs.existsSync(path.join(from, 'config.json'))).toBe(true);
        expect(fs.existsSync(path.join(from, 'yodaman.db'))).toBe(true);
    });

    test('never overwrites data already in the data folder', () => {
        const { from, db } = oldInstall();
        db.close();
        const env = { YODAMAN_DATA_DIR: scratch() };
        fs.writeFileSync(dataPaths.configPath(env), JSON.stringify({ watchedDirectories: ['/work/naboo'] }));
        const result = dataPaths.prepareDataDir({ from, env });
        expect(result.copied).toEqual(['yodaman.db']);
        expect(JSON.parse(fs.readFileSync(dataPaths.configPath(env), 'utf8')).watchedDirectories).toEqual(['/work/naboo']);
    });

    test('a fresh install has nothing to bring over, and that is not an error', () => {
        const env = { YODAMAN_DATA_DIR: path.join(scratch(), 'nested', 'YodaMan') };
        expect(dataPaths.prepareDataDir({ from: scratch(), env })).toEqual({ copied: [], failed: [] });
        expect(fs.existsSync(dataPaths.dataDir(env))).toBe(true);
    });

    test('a file that cannot be copied is reported, not thrown', () => {
        const from = scratch();
        fs.writeFileSync(path.join(from, 'yodaman.db'), 'not a database');
        const result = dataPaths.prepareDataDir({ from, env: { YODAMAN_DATA_DIR: scratch() } });
        expect(result.copied).toEqual([]);
        expect(result.failed.map((f) => f.file)).toEqual(['yodaman.db']);
    });
});

describe('whoever touches the data first', () => {
    test('opening the database before any server starts still brings the old one over', () => {
        // The release smoke required Database.js directly: it created an empty
        // yodaman.db in the data folder, and the copy that followed refused to
        // overwrite it, so 28 tasks stayed behind. Reproduced with a throwaway
        // install that has an old yodaman.db beside its code.
        const root = path.join(__dirname, '../..');
        const install = scratch();
        fs.cpSync(path.join(root, 'backend'), path.join(install, 'backend'), { recursive: true });
        fs.cpSync(path.join(root, 'shared'), path.join(install, 'shared'), { recursive: true });
        fs.symlinkSync(path.join(root, 'node_modules'), path.join(install, 'node_modules'), 'dir');
        const { DatabaseSync } = require('node:sqlite');
        const old = new DatabaseSync(path.join(install, 'yodaman.db'));
        old.exec("CREATE TABLE tasks (taskId TEXT PRIMARY KEY, task TEXT, projectId TEXT, status TEXT, createdAt TEXT, updatedAt TEXT, pendingApproval TEXT, finalAnswer TEXT, error TEXT, events TEXT); INSERT INTO tasks (taskId) VALUES ('order-66');");
        old.close();

        const env = { ...process.env, YODAMAN_DATA_DIR: scratch(), YODAMAN_LOG_DIR: scratch() };
        delete env.YODAMAN_DB_PATH;
        // A fresh process that opens the database first, as the smoke did.
        require('child_process').execFileSync(process.execPath,
            ['-e', `require(${JSON.stringify(path.join(install, 'backend/infrastructure/Database.js'))})`],
            { env, stdio: 'pipe' });

        const copy = new DatabaseSync(dataPaths.databasePath(env));
        expect(copy.prepare('SELECT taskId FROM tasks').all().map((r) => r.taskId)).toEqual(['order-66']);
        copy.close();
    }, 30000);

    test('Database.js prepares the folder itself, before it opens the file', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../backend/infrastructure/Database.js'), 'utf8');
        expect(source.indexOf('prepareDataDir()')).toBeGreaterThan(-1);
        expect(source.indexOf('prepareDataDir()')).toBeLessThan(source.indexOf('new DatabaseSync('));
    });
});

describe('what the Dashboard shows', () => {
    test('each file: where it is, whether it exists, its size', () => {
        const env = { YODAMAN_DATA_DIR: scratch() };
        fs.writeFileSync(dataPaths.configPath(env), '{}');
        const info = dataPaths.describeDataFiles(env);
        expect(info.dataDir).toBe(path.resolve(env.YODAMAN_DATA_DIR));
        expect(info.config).toMatchObject({ path: dataPaths.configPath(env), exists: true, bytes: 2 });
        expect(info.database).toMatchObject({ path: dataPaths.databasePath(env), exists: false, bytes: 0, modifiedAt: null });
    });
});

describe('nothing reads them from the install any more', () => {
    test('no module builds a config.json or yodaman.db path beside the code', () => {
        const root = path.join(__dirname, '../..');
        const files = ['server.js', 'bin/yodaman.js', 'electron/main.js'];
        const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.name.endsWith('.js')) files.push(path.relative(root, full));
        });
        walk(path.join(root, 'backend'));
        const offenders = files.filter((file) => file !== 'backend/infrastructure/DataPaths.js'
            && /(__dirname|process\.cwd\(\))[^\n;]*['"](\.\.?\/)*(config\.json|yodaman\.db)['"]/.test(fs.readFileSync(path.join(root, file), 'utf8')));
        expect(offenders).toEqual([]);
    });
});
