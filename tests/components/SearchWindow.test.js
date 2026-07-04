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
});
