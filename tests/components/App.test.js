const fs = require('fs');
const path = require('path');

describe('App.jsx tab persistence contract', () => {
    const componentPath = path.resolve(__dirname, '../../src/App.jsx');

    test('renders all tabs with display contents/none instead of conditional unmounting', () => {
        const text = fs.readFileSync(componentPath, 'utf8');

        // All tabs should use style display for show/hide, not conditional rendering
        expect(text).toContain("display: activeTab === 'chat' ? 'contents' : 'none'");
        expect(text).toContain("display: activeTab === 'search' ? 'contents' : 'none'");
        expect(text).toContain("display: activeTab === 'graph' ? 'contents' : 'none'");
        expect(text).toContain("display: activeTab === 'dashboard' ? 'contents' : 'none'");
        expect(text).toContain("display: activeTab === 'stardust' ? 'contents' : 'none'");
        expect(text).toContain("display: activeTab === 'plugins' ? 'contents' : 'none'");
    });

    test('tab wrappers do not use flex-1 or h-full classes that cause layout issues', () => {
        const text = fs.readFileSync(componentPath, 'utf8');

        // No wrapper div in tab area should have flex-1 or h-full class
        const tabContentStart = text.indexOf('flex-1 overflow-y-auto bg-white');
        const tabContentEnd = text.indexOf('</main>', tabContentStart);
        const tabContent = text.slice(tabContentStart, tabContentEnd);

        // Each wrapper div should only have style, no className
        const wrapperPattern = /<div style=\{\{display: activeTab === '[^']+' \? 'contents' : 'none'\}\}>/g;
        const matches = tabContent.match(wrapperPattern);
        expect(matches).not.toBeNull();
        expect(matches.length).toBe(6);
    });

    test('does not use conditional render pattern for tabs', () => {
        const text = fs.readFileSync(componentPath, 'utf8');

        const tabContentStart = text.indexOf('flex-1 overflow-y-auto bg-white');
        const tabContentEnd = text.indexOf('</main>', tabContentStart);
        const tabContent = text.slice(tabContentStart, tabContentEnd);

        // Each tab component should appear without the && pattern before it
        expect(tabContent).toContain('<AgentChatTab');
        expect(tabContent).toContain('<SearchWindow');
        expect(tabContent).toContain('<GraphStudio');
        expect(tabContent).toContain('<Dashboard');
        expect(tabContent).toContain('<Stardust');
        expect(tabContent).toContain('<PluginsWindow');
    });
});
