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

describe('the AI summary panel', () => {
    function renderSummary(summary, props = {}) {
        require('../helpers/browserStub').installBrowserStub();
        const React = require('react');
        const { renderToStaticMarkup } = require('react-dom/server');
        const { SearchSummary } = require('../../src/components/SearchWindow');
        return renderToStaticMarkup(React.createElement(SearchSummary, { summary, ...props }));
    }

    test('each citation of a real result links to it; others stay plain text', () => {
        const html = renderSummary({ state: 'done', text: 'Ranked here [1][2], tagged there [9].' }, { resultCount: 2 });
        expect(html).toContain('aria-label="Go to result 1"');
        expect(html).toContain('aria-label="Go to result 2"');
        expect(html).not.toContain('Go to result 9');
        expect(html).toContain('tagged there [9].');
    });

    test('clicking a citation asks for that result', () => {
        require('../helpers/browserStub').installBrowserStub();
        const { SearchSummary } = require('../../src/components/SearchWindow');
        const cited = [];
        const tree = SearchSummary({ summary: { state: 'done', text: 'See [2].' }, resultCount: 3, onCite: (n) => cited.push(n) });
        const buttons = [];
        (function walk(node) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) return node.forEach(walk);
            if (node.type === 'button') buttons.push(node);
            walk(node.props?.children);
        })(tree);
        buttons.find((b) => b.props['aria-label'] === 'Go to result 2').props.onClick();
        expect(cited).toEqual([2]);
    });

    test('says it summarises these results, with the local model that wrote it', () => {
        const html = renderSummary({ state: 'done', text: 'Ranked in the pipeline [1].', model: 'qwen3.5:9b' });
        expect(html).toContain('AI summary of these results');
        expect(html).toContain('qwen3.5:9b, on this machine');
        expect(html).toContain('Ranked in the pipeline [1].');
    });

    test('shows it is working before the first words arrive', () => {
        expect(renderSummary({ state: 'writing', text: '', model: 'm' })).toContain('Reading the results');
    });

    test('a failure is said plainly, under whatever was written', () => {
        const html = renderSummary({ state: 'error', text: 'Partial', error: 'connect ECONNREFUSED' });
        expect(html).toContain('Partial');
        expect(html).toContain('Summary unavailable: connect ECONNREFUSED');
    });
});
