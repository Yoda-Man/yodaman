/**
 * Where YodaMan keeps the user's data: config.json (settings and workspaces)
 * and yodaman.db (task history and audit log).
 *
 * They used to sit next to the code, inside the app bundle or the npm
 * package, so every upgrade replaced the folder and erased them, and writing
 * into a signed macOS bundle breaks its signature. They now live in the
 * per-user application data folder, the same one Electron uses for the app:
 *
 *   macOS    ~/Library/Application Support/YodaMan
 *   Windows  %APPDATA%\YodaMan
 *   Linux    $XDG_CONFIG_HOME/YodaMan (~/.config/YodaMan)
 *
 * YODAMAN_DATA_DIR moves the folder; YODAMAN_CONFIG_PATH and YODAMAN_DB_PATH
 * still point at single files, as tests and existing setups rely on.
 *
 * No logger here: the CLI resolves paths too, and must not print log lines.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_FOLDER = 'YodaMan';
// The previous home of both files: the install folder itself.
const INSTALL_ROOT = path.join(__dirname, '../..');

function defaultDataDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
    if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', APP_FOLDER);
    if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP_FOLDER);
    return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), APP_FOLDER);
}

function dataDir(env = process.env) {
    return env.YODAMAN_DATA_DIR ? path.resolve(env.YODAMAN_DATA_DIR) : defaultDataDir({ env });
}

function configPath(env = process.env) {
    return env.YODAMAN_CONFIG_PATH || path.join(dataDir(env), 'config.json');
}

function databasePath(env = process.env) {
    return env.YODAMAN_DB_PATH || path.join(dataDir(env), 'yodaman.db');
}

/**
 * Copy data left in the install folder by an earlier version into the data
 * folder, once: only when the data folder does not have that file yet.
 *
 * Copied, never moved: running an older version again still finds its data.
 * The database is copied with VACUUM INTO, a consistent snapshot even if an
 * older runtime still has it open, and it carries rows still in the -wal file
 * that a plain file copy would lose.
 *
 * @returns {{ copied: string[], failed: Array<{ file: string, error: string }> }}
 */
function migrateLegacyData({ from = INSTALL_ROOT, env = process.env } = {}) {
    const result = { copied: [], failed: [] };
    const targets = [
        { file: 'config.json', to: configPath(env), copy: (source, target) => fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL) },
        { file: 'yodaman.db', to: databasePath(env), copy: snapshotDatabase }
    ];
    for (const { file, to, copy } of targets) {
        const source = path.join(from, file);
        if (path.resolve(source) === path.resolve(to) || fs.existsSync(to) || !fs.existsSync(source)) continue;
        try {
            fs.mkdirSync(path.dirname(to), { recursive: true });
            copy(source, to);
            result.copied.push(file);
        } catch (err) {
            result.failed.push({ file, error: err.message });
        }
    }
    return result;
}

function snapshotDatabase(source, target) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(source);
    try {
        db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    } finally {
        db.close();
    }
}

/** Ready the data folder: create it, and bring over data from an older install. */
function prepareDataDir(options = {}) {
    const env = options.env || process.env;
    fs.mkdirSync(dataDir(env), { recursive: true });
    return migrateLegacyData({ ...options, env });
}

/** What the Dashboard shows: where each file is, and whether it exists yet. */
function describeDataFiles(env = process.env) {
    const file = (filePath) => {
        const stat = fs.statSync(filePath, { throwIfNoEntry: false });
        return { path: filePath, exists: Boolean(stat), bytes: stat ? stat.size : 0, modifiedAt: stat ? stat.mtime.toISOString() : null };
    };
    return { dataDir: dataDir(env), config: file(configPath(env)), database: file(databasePath(env)) };
}

module.exports = {
    INSTALL_ROOT,
    defaultDataDir,
    dataDir,
    configPath,
    databasePath,
    migrateLegacyData,
    prepareDataDir,
    describeDataFiles
};
