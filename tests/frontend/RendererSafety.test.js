const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function sourceFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(filePath);
        return /\.(js|jsx)$/.test(entry.name) ? [filePath] : [];
    });
}

describe('renderer safety', () => {
    const srcDir = path.resolve(__dirname, '../../src');

    test('browser components do not reference Node-only process globals', () => {
        const offenders = sourceFiles(srcDir)
            .filter(filePath => /\bprocess\s*\./.test(fs.readFileSync(filePath, 'utf8')))
            .map(filePath => path.relative(srcDir, filePath));

        expect(offenders).toEqual([]);
    });

    test('every JSX component has an in-scope import or declaration', () => {
        const missing = [];

        sourceFiles(srcDir).forEach(filePath => {
            const source = fs.readFileSync(filePath, 'utf8');
            const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
            traverse(ast, {
                JSXOpeningElement(elementPath) {
                    const name = elementPath.node.name;
                    if (name.type !== 'JSXIdentifier' || !/^[A-Z]/.test(name.name)) return;
                    if (!elementPath.scope.hasBinding(name.name)) {
                        missing.push(`${path.relative(srcDir, filePath)}:${name.name}`);
                    }
                }
            });
        });

        expect(missing).toEqual([]);
    });

    test('the React root is protected by a recoverable error boundary', () => {
        const main = fs.readFileSync(path.join(srcDir, 'main.jsx'), 'utf8');
        const boundary = fs.readFileSync(path.join(srcDir, 'components', 'AppErrorBoundary.jsx'), 'utf8');

        expect(main).toContain('<AppErrorBoundary>');
        expect(boundary).toContain('componentDidCatch');
        expect(boundary).toContain('Reload YodaMan');
    });
});
