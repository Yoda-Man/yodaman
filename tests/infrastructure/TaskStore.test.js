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
