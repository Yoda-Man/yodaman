/**
 * The welcome tour may only send people to tabs that exist.
 *
 * It said "Use the Search tab" when search is a mode inside the Chat tab.
 */
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

test('every tab the welcome tour names is a tab in the app', () => {
    const app = read('src/App.jsx');
    // Tab buttons are `onClick={() => setActiveTab('x')}` followed by an icon and the label.
    const tabs = [...app.matchAll(/setActiveTab\('\w+'\)\}[\s\S]*?\/>\s*(\w+)\s*<\/button>/g)].map((m) => m[1]);
    expect(tabs).toEqual(expect.arrayContaining(['Chat', 'Graph', 'Dashboard', 'Plugins', 'Stardust']));

    const named = [...read('src/components/WelcomeModal.jsx').matchAll(/\b(\w+) tab\b/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const tab of named) expect(tabs).toContain(tab);
});
