/**
 * Jest transformer: JSX + ESM → CJS via sucrase, for the frontend only.
 *
 * Lets tests import the real `src/**` components instead of only reading them as
 * text. sucrase ships with the toolchain already, so this adds no dependency.
 *
 * Everything else is handed to babel-jest, which is what Jest uses by default.
 * Declaring a `transform` in package.json replaces that default outright, and the
 * default does more than parse: babel-preset-jest hoists `jest.mock()` calls above
 * the requires they need to intercept. Passing those files through untouched left
 * the mocks in place but too late to take effect, which silently broke the
 * ContextEngine and QueueService suites.
 */
const crypto = require('crypto');
const path = require('path');
const { transform } = require('sucrase');

// Bump when the transform options below change, so old cache entries are dropped.
const TRANSFORM_VERSION = 'sucrase-jsx-automatic-cjs-v5';

const babelJest = require('babel-jest').default.createTransformer({});

const SEP = path.sep;

function isFrontend(sourcePath) {
    // The test files themselves are CommonJS and rely on babel-jest, even the ones
    // living under tests/frontend/.
    if (sourcePath.includes(`${SEP}tests${SEP}`)) return false;

    if (sourcePath.endsWith('.jsx')) return true;                                    // components
    if (sourcePath.includes(`${SEP}src${SEP}`)) return true;                         // frontend modules (ESM)
    if (sourcePath.includes(`${SEP}frontend${SEP}`)) return true;                    // browser helpers (ESM)
    if (sourcePath.includes(`${SEP}node_modules${SEP}three${SEP}`)) return true;     // ESM-only dep
    return false;
}

module.exports = {
    process(sourceText, sourcePath, options) {
        if (!isFrontend(sourcePath)) {
            return babelJest.process(sourceText, sourcePath, options);
        }

        // `import.meta` is a syntax error once the module becomes CJS. Vite replaces
        // it at build time; do the same here so `import.meta.env` reads work.
        const shimmed = sourceText.replace(/import\.meta/g, 'globalThis.__viteImportMeta__');

        const { code } = transform(shimmed, {
            transforms: ['jsx', 'imports'],
            // Matches the app's Vite config: components do not import React themselves.
            jsxRuntime: 'automatic',
            production: true,
            filePath: sourcePath
        });
        return { code };
    },

    // Jest uses this as the whole cache key, so it MUST vary with the file's
    // contents and path. A constant here makes every module collide on one cache
    // entry and Jest serves whichever file was transformed first.
    getCacheKey(sourceText, sourcePath, options) {
        const delegated = isFrontend(sourcePath)
            ? 'sucrase'
            : babelJest.getCacheKey(sourceText, sourcePath, options);

        return crypto
            .createHash('sha1')
            .update(TRANSFORM_VERSION)
            .update('\0')
            .update(delegated)
            .update('\0')
            .update(sourcePath)
            .update('\0')
            .update(sourceText)
            .digest('hex');
    }
};
