/**
 * Holocron voice commands, and the route traced when flying between nodes.
 */
const { parseVoiceCommand, spokenVariants } = require('../../src/holocron/voice');
const { buildModel, shortestPath } = require('../../src/holocron/graphModel');

describe('what a spoken command means', () => {
    test.each([
        ['Where is AuthService', 'AuthService'],
        ["where's the database manager?", 'database manager'],
        ['Hey Yoda, fly to main window', 'main window'],
        ['fly me to search pipeline', 'search pipeline'],
        ['go to graphify service dot js', 'graphify service.js'],
        ['show me the ToolBox', 'ToolBox'],
        ['find RestController', 'RestController']
    ])('"%s" flies to "%s"', (said, query) => {
        expect(parseVoiceCommand(said)).toEqual({ action: 'fly', query });
    });

    test.each([
        ['reset camera', { action: 'reset' }],
        ['Home.', { action: 'reset' }],
        ['clear selection', { action: 'clear' }],
        ['hide tests', { action: 'filter', key: 'hideTests', value: true }],
        ['show docs', { action: 'filter', key: 'hideDocs', value: false }],
        ['hide third party', { action: 'filter', key: 'hideThirdParty', value: true }],
        ['heatmap on', { action: 'heatmap', value: true }],
        ['turn the heat map off', { action: 'heatmap', value: false }],
        ['show heatmap', { action: 'heatmap', value: true }],
        ['play history', { action: 'play' }],
        ['pause', { action: 'pause' }],
        ['back to now', { action: 'live' }]
    ])('"%s"', (said, expected) => {
        expect(parseVoiceCommand(said)).toEqual(expected);
    });

    test('speech that is not a command is not guessed at', () => {
        expect(parseVoiceCommand('')).toBeNull();
        expect(parseVoiceCommand('the weather is nice')).toBeNull();
        // "show" with something that is not a filter is a fly-to, not a filter.
        expect(parseVoiceCommand('show me ToolBox').action).toBe('fly');
    });

    test('spoken names are tried as said, joined, and snake_cased', () => {
        expect(spokenVariants('auth service')).toEqual(['auth service', 'authservice', 'auth_service']);
        expect(spokenVariants('ToolBox')).toEqual(['ToolBox']);
    });
});

describe('the route between two nodes', () => {
    // a - b - c - d, and e on its own; links are followed in either direction.
    const model = buildModel({
        nodes: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id })),
        links: [{ source: 'a', target: 'b' }, { source: 'c', target: 'b' }, { source: 'c', target: 'd' }]
    });
    const at = (id) => model.nodes.find((n) => n.id === id).index;

    test('is the shortest chain of links, regardless of direction', () => {
        expect(shortestPath(model, at('a'), at('d')).map((i) => model.nodes[i].id)).toEqual(['a', 'b', 'c', 'd']);
    });

    test('is null when the nodes are not connected', () => {
        expect(shortestPath(model, at('a'), at('e'))).toBeNull();
    });

    test('respects a depth limit', () => {
        expect(shortestPath(model, at('a'), at('d'), 2)).toBeNull();
        expect(shortestPath(model, at('a'), at('a'))).toEqual([at('a')]);
    });
});
