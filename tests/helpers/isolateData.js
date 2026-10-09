/**
 * Every test run gets its own data folder.
 *
 * config.json and yodaman.db default to the user's real data folder (see
 * backend/infrastructure/DataPaths.js). A test that forgot to override them
 * would read the user's workspaces and write fake tasks into their history,
 * so the default itself points somewhere disposable for the whole suite.
 */
const os = require('os');
const path = require('path');

// One parent folder, so every run's leftovers are in one place; the folder
// for a worker is only created if something in it actually writes.
if (!process.env.YODAMAN_DATA_DIR) {
    process.env.YODAMAN_DATA_DIR = path.join(os.tmpdir(), 'yodaman-test-data', String(process.pid));
}
