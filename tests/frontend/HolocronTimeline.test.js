/**
 * Holocron's time slider: git history mapped onto the graph.
 */
const { buildModel } = require('../../src/holocron/graphModel');
const { indexTimeline, stateAt, formatDate, ACTIVITY_WINDOW_MS } = require('../../src/holocron/timeline');

const DAY = 24 * 60 * 60 * 1000;
const model = buildModel({
    nodes: [
        { id: 'db', label: 'Database', sourceFile: 'core/database.py' },
        { id: 'conn', label: 'connect()', sourceFile: 'core/database.py' },
        { id: 'ui', label: 'Window', sourceFile: 'ui/window.py' },
        { id: 'new', label: 'Feature', sourceFile: 'feature/new.py' },
        { id: 'idea', label: 'concept' }
    ],
    links: []
});
const at = (id) => model.nodes.find((n) => n.id === id).index;
const NOW = Date.parse('2026-10-09T00:00:00Z');
const commits = [
    { date: '2026-06-01T00:00:00Z', files: [{ path: 'core/database.py', status: 'M' }, { path: 'ui/window.py', status: 'M' }] },
    { date: '2026-09-20T00:00:00Z', files: [{ path: 'feature/new.py', status: 'A' }] },
    { date: '2026-10-05T00:00:00Z', files: [{ path: './core/database.py', status: 'M' }, { path: 'unrelated.txt', status: 'M' }] }
];
const timeline = indexTimeline(model, commits, NOW);

test('every symbol in a file shares the file\'s history', () => {
    expect(timeline.events[at('db')]).toEqual(timeline.events[at('conn')]);
    expect(timeline.events[at('db')]).toHaveLength(2);
    expect(timeline.events[at('idea')]).toEqual([]);
    expect(timeline.matched).toBe(4);
});

test('the slider runs from the first commit to now, with month ticks and commit density', () => {
    expect(timeline.start).toBe(Date.parse('2026-06-01T00:00:00Z'));
    expect(timeline.end).toBe(NOW);
    expect(timeline.months.map((m) => m.label)).toEqual(["Jul '26", "Aug '26", "Sep '26", "Oct '26"]);
    expect(timeline.buckets.reduce((a, b) => a + b, 0)).toBe(3);
    expect(timeline.commitCount).toBe(3);
});

test('heat is recent activity: strongest right after a change, gone after the window', () => {
    const justAfter = stateAt(timeline, Date.parse('2026-10-05T12:00:00Z'));
    const later = stateAt(timeline, Date.parse('2026-10-15T00:00:00Z'));
    const muchLater = stateAt(timeline, Date.parse('2026-10-05T00:00:00Z') + ACTIVITY_WINDOW_MS + DAY);
    expect(justAfter.heat[at('db')]).toBeGreaterThan(later.heat[at('db')]);
    expect(later.heat[at('db')]).toBeGreaterThan(0);
    expect(muchLater.heat[at('db')]).toBe(0);
    expect(justAfter.heat[at('ui')]).toBe(0);           // its change was in June
    expect(justAfter.active).toBe(2);                    // db and connect()
});

test('a file added later does not exist before it was added', () => {
    expect(stateAt(timeline, Date.parse('2026-09-01T00:00:00Z')).exists[at('new')]).toBe(0);
    expect(stateAt(timeline, Date.parse('2026-09-21T00:00:00Z')).exists[at('new')]).toBe(1);
    // No "added" record (it predates the history): always present.
    expect(stateAt(timeline, Date.parse('2026-01-01T00:00:00Z')).exists[at('db')]).toBe(1);
});

test('the future does not count', () => {
    const state = stateAt(timeline, Date.parse('2026-06-01T00:00:00Z') - DAY);
    expect(state.active).toBe(0);
});

test('no history is a valid, empty timeline', () => {
    const empty = indexTimeline(model, [], NOW);
    expect(empty.commitCount).toBe(0);
    expect(stateAt(empty, NOW).active).toBe(0);
    expect(formatDate(Date.parse('2026-05-20T15:42:00Z'))).toBe('20 May 2026');
});
