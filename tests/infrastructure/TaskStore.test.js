// TaskStore test
describe('TaskStore',()=>{
  let store;
  beforeAll(()=>{
    delete require.cache[require.resolve('../../backend/infrastructure/TaskStore')];
    store=require('../../backend/infrastructure/TaskStore');
  });
  test('exports list function',()=>{expect(typeof store.list).toBe('function');});
  test('list returns array',()=>{expect(Array.isArray(store.list())).toBe(true);});
  test('exports upsert',()=>{expect(typeof store.upsert).toBe('function');});
  test('exports clear',()=>{expect(typeof store.clear).toBe('function');});
});

describe('TaskStore prune', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  test('rows beyond the newest 100 are deleted from SQLite, not just from memory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-taskstore-'));
    const previous = process.env.YODAMAN_DB_PATH;
    process.env.YODAMAN_DB_PATH = path.join(dir, 'tasks.db');
    let store; let database;
    try {
      jest.isolateModules(() => {
        database = require('../../backend/infrastructure/Database');
        store = require('../../backend/infrastructure/TaskStore');
      });
      expect(database.useSqlite).toBe(true);
      for (let i = 0; i < 105; i++) store.upsert(`task-${i}`, { task: 't', status: 'completed' });
      const rows = database.db.prepare('SELECT taskId FROM tasks').all().map((row) => row.taskId);
      expect(rows).toHaveLength(100);
      expect(store.list()).toHaveLength(100);
      expect(rows).toContain('task-104');
    } finally {
      database?.db?.close();
      if (previous === undefined) delete process.env.YODAMAN_DB_PATH; else process.env.YODAMAN_DB_PATH = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
