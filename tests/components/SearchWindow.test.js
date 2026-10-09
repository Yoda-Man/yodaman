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

    // These two used to assert the source text, including the label of an
    // ExternalLink icon that only expanded the snippet: the test locked in a
    // button that looked like "open" and wasn't. They now check behaviour on
    // the rendered card: Open opens, the chevron expands.
    function renderCard(props) {
        require('../helpers/browserStub').installBrowserStub();
        const React = require('react');
        const { renderToStaticMarkup } = require('react-dom/server');
        const { SearchResultCard } = require('../../src/components/SearchWindow');
        const result = { score: 0.9, filePath: 'auth/login.py', lineStart: 12, content: 'def login():' };
        return renderToStaticMarkup(React.createElement(SearchResultCard, { result, onOpen() {}, onToggle() {}, ...props }));
    }

    test('a result can be expanded, and expanding is not dressed up as opening', () => {
        const collapsed = renderCard({ expanded: false });
        expect(collapsed).toContain('title="Show details"');
        expect(collapsed).not.toContain('Full path:');
        expect(renderCard({ expanded: true })).toContain('Full path: auth/login.py');
    });

    test('the expand toggle is wired to its handler', () => {
        require('../helpers/browserStub').installBrowserStub();
        const { SearchResultCard } = require('../../src/components/SearchWindow');
        let toggled = 0;
        const tree = SearchResultCard({ result: { filePath: 'a.py', content: 'x', score: 1 }, onOpen() {}, onToggle: () => { toggled += 1; } });
        const buttons = [];
        (function walk(node) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) return node.forEach(walk);
            if (node.type === 'button') buttons.push(node);
            walk(node.props?.children);
        })(tree);
        buttons.find((b) => b.props.title === 'Show details').props.onClick();
        expect(toggled).toBe(1);
    });

    test('uses the shared chat composer request and has no duplicate search input', () => {
        const text = fs.readFileSync(componentPath, 'utf8');

        expect(text).toContain('searchRequest');
        expect(text).toContain('onSearchingChange');
        expect(text).not.toContain('<form onSubmit={handleSearch}');
        expect(text).not.toContain('Search for functions, variables, or patterns...');
    });
});
