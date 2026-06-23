// PairingService test
describe('PairingService',()=>{
  let p;
  beforeAll(()=>{
    delete require.cache[require.resolve('../../backend/infrastructure/PairingService')];
    p=require('../../backend/infrastructure/PairingService');
  });
  test('exports functions',()=>{
    expect(typeof p.generate === 'function' || typeof p.createPairingUrl === 'function' || typeof p.validate === 'function').toBe(true);
  });
});
