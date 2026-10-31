/**
 * Runs Babel over source files and reports, per file, the identifiers that are
 * never bound.
 *
 * Babel 8 is ESM-only. Node 24 loads it with require(esm), but Jest's module
 * registry only does so under --experimental-vm-modules, and that flag breaks a
 * dozen other suites. So the tests call scan(), which runs this same file in a
 * plain Node process where require(esm) just works.
 */
const { spawnSync } = require('child_process');

/** @returns {{ file: string, error?: string, globals?: string[], unboundJsx?: string[] }[]} */
function scan(files, parseOptions) {
    const result = spawnSync(process.execPath, [__filename], {
        input: JSON.stringify({ files, parseOptions }),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
    });
    if (result.status !== 0) throw new Error(`babelScan failed: ${result.stderr || result.error}`);
    return JSON.parse(result.stdout);
}

if (require.main === module) {
    const fs = require('fs');
    const parser = require('@babel/parser');
    const traverse = require('@babel/traverse').default;
    const { files, parseOptions } = JSON.parse(fs.readFileSync(0, 'utf8'));

    const results = files.map((file) => {
        let ast;
        try {
            ast = parser.parse(fs.readFileSync(file, 'utf8'), parseOptions);
        } catch (error) {
            return { file, error: error.message.split('\n')[0] };
        }
        const globals = [];
        const unboundJsx = [];
        traverse(ast, {
            Program(programPath) {
                globals.push(...Object.keys(programPath.scope.globals));
            },
            JSXOpeningElement(elementPath) {
                const name = elementPath.node.name;
                if (name.type === 'JSXIdentifier' && /^[A-Z]/.test(name.name)
                    && !elementPath.scope.hasBinding(name.name)) {
                    unboundJsx.push(name.name);
                }
            }
        });
        return { file, globals, unboundJsx };
    });
    process.stdout.write(JSON.stringify(results));
}

module.exports = { scan };
