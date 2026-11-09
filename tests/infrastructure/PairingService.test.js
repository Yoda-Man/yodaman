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

describe('pairing links a phone can use', () => {
  const p = require('../../backend/infrastructure/PairingService');
  const lan = (port) => `http://192.168.1.20:${port}`;
  beforeEach(() => { jest.spyOn(p, 'getLanRuntimeUrl').mockImplementation((port = 3090) => lan(port)); });
  afterEach(() => jest.restoreAllMocks());

  test('a loopback URL from this computer becomes the LAN address, same port', () => {
    expect(p.createPairing('http://127.0.0.1:3090').runtimeUrl).toBe(lan(3090));
    expect(p.createPairing('http://localhost:5190').runtimeUrl).toBe(lan(5190));
    expect(p.createPairing().runtimeUrl).toBe(lan(3090));
  });

  test('a URL that already reaches this machine is kept', () => {
    expect(p.createPairing('http://10.0.0.5:3090').runtimeUrl).toBe('http://10.0.0.5:3090');
  });
});
