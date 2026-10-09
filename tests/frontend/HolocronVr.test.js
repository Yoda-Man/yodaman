/**
 * Holocron's headset decisions, tested without a headset.
 */
const { buildModel } = require('../../src/holocron/graphModel');
const { vrFit, nextScale, panelContent, drawPanel, VR_RADIUS_M } = require('../../src/holocron/vr');

test('any layout is shrunk to a few metres, in front of the user at chest height', () => {
    for (const radius of [8, 30, 120]) {
        const { scale, position } = vrFit(radius);
        expect(radius * scale).toBeCloseTo(VR_RADIUS_M, 6);
        expect(position[1]).toBeGreaterThan(1);       // chest height, not the floor
        expect(position[2]).toBeLessThan(-1.5);       // in front (WebXR looks down -z)
    }
});

test('the thumbstick scales smoothly, within limits', () => {
    const base = 0.05;
    expect(nextScale(base, base, -1, 0.1)).toBeGreaterThan(base);   // push up: bigger
    expect(nextScale(base, base, 1, 0.1)).toBeLessThan(base);
    let s = base;
    for (let i = 0; i < 500; i++) s = nextScale(s, base, -1, 0.1);
    expect(s).toBeCloseTo(base * 4, 6);
    for (let i = 0; i < 500; i++) s = nextScale(s, base, 1, 0.1);
    expect(s).toBeCloseTo(base * 0.25, 6);
});

describe('the floating panel', () => {
    const model = buildModel({
        nodes: [
            { id: 'db', label: 'DatabaseManager', community: 1, sourceFile: 'core/database.py', sourceLocation: 'L41' },
            { id: 'conn', label: 'connect()', community: 1, sourceFile: 'core/database.py' },
            { id: 'win', label: 'MainWindow', community: 2, sourceFile: 'ui/window.py' }
        ],
        links: [{ source: 'db', target: 'conn' }, { source: 'win', target: 'db' }]
    });
    const db = model.nodes.find((n) => n.id === 'db').index;

    test('says what the desktop panel says', () => {
        const content = panelContent(model, db, { changes: { count: 3 } });
        expect(content.title).toBe('DatabaseManager');
        expect(content.subtitle).toBe('core/database.py:41');
        expect(content.stats).toEqual([['Links', 2], ['Uses', 1], ['Used by', 1], ['Changes', 3]]);
        expect(content.uses).toEqual(['connect()']);
        expect(content.usedBy).toEqual(['MainWindow']);
        expect(content.color).toBe(model.clusters[model.nodes[db].cluster].color);
    });

    test('leaves out the change count when it is not known, rather than claiming 0', () => {
        expect(panelContent(model, db).stats.map(([label]) => label)).toEqual(['Links', 'Uses', 'Used by']);
        expect(panelContent(model, db, { changes: null }).stats).toContainEqual(['Changes', 0]);
    });

    test('paints every part onto the canvas, truncating what does not fit', () => {
        const drawn = [];
        const ctx = {
            clearRect() {}, beginPath() {}, fill() {}, stroke() {}, arc() {}, rect() {}, roundRect() {}, fillRect() {},
            measureText: (text) => ({ width: text.length * 20 }),
            fillText: (text) => drawn.push(text)
        };
        drawPanel(ctx, { ...panelContent(model, db), title: 'X'.repeat(200) });
        expect(drawn.some((t) => t.endsWith('…'))).toBe(true);
        for (const expected of ['core/database.py:41', 'LINKS', 'USES', 'USED BY', 'connect()', 'MainWindow']) {
            expect(drawn).toContain(expected);
        }
    });
});

test('controllers are drawn locally: no model files fetched from a CDN', () => {
    // three's XRControllerModelFactory downloads controller meshes from a
    // public CDN, which the CSP blocks and local-first forbids.
    const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/holocron/scene.js'), 'utf8');
    expect(source).not.toMatch(/XRControllerModelFactory|XRHandModelFactory|GLTFLoader|https?:\/\//);
    expect(source).toMatch(/getController\(/);
});
