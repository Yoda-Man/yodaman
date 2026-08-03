const fs = require('fs');
const path = require('path');

describe('SearchWindow component contract', () => {
    const componentPath = path.resolve(__dirname, '../../src/components/SearchWindow.jsx');

    test('shows the empty result state only after a search completes', () => {
        const text = fs.readFileSync(componentPath, 'utf8');

        expect(text).toContain("const [hasSearched, setHasSearched] = useState(false)");
        expect(text).toContain('setHasSearched(true)');
        expect(text).toContain('results.length === 0 && hasSearched');
    });

    test('has expand/collapse state for search results', () => {
        const text = fs.readFileSync(componentPath, 'utf8');

        expect(text).toContain('expandedResults');
        expect(text).toContain('setExpandedResults');
        expect(text).toContain('ChevronUp');
        expect(text).toContain('View full content');
    });

    test('search result view button has onClick handler', () => {
        const text = fs.readFileSync(componentPath, 'utf8');

        // The ExternalLink/expand button must have an onClick with setExpandedResults
        const viewButtonRegex = /onClick\s*=\s*\{[^}]*setExpandedResults[^}]*\}/s;
        expect(viewButtonRegex.test(text)).toBe(true);
    });

    test('uses the shared chat composer request and has no duplicate search input', () => {
        const text = fs.readFileSync(componentPath, 'utf8');

        expect(text).toContain('searchRequest');
        expect(text).toContain('onSearchingChange');
        expect(text).not.toContain('<form onSubmit={handleSearch}');
        expect(text).not.toContain('Search for functions, variables, or patterns...');
    });
});
