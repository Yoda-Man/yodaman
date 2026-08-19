const js = require('@eslint/js');
const globals = require('globals');

/**
 * Baseline lint config.
 *
 * Deliberately narrow: this repo had no linter at all, so a maximalist ruleset
 * would bury the signal under thousands of style complaints on day one. The
 * rules enabled here are correctness and security-adjacent — the classes of
 * defect the August 2026 audit actually found (silently swallowed errors, shell
 * strings, unreachable code). Style rules can be layered on later.
 */
module.exports = [
    {
        ignores: [
            'dist/**',
            'release/**',
            // Spawned git worktrees are full copies of the repo at some other
            // commit. Linting them reports that older commit's problems as if
            // they were current — which failed this gate on empty catch blocks
            // that had already been fixed on the branch being verified.
            '.claude/worktrees/**',
            'coverage/**',
            'node_modules/**',
            'extensions/*/node_modules/**',
            'apps/*/node_modules/**',
            'website/**',
            'graphify-out/**',
            // Minified Holocron VR bundles (VRViewer.js is 33 KB across 4 lines).
            // Both are load-bearing and referenced only as strings — see the
            // header comment in UIPanel.js — so they are kept but not linted.
            'frontend/UIPanel.js',
            'frontend/VRViewer.js',
            // Synthetic inputs for the CodeTrooper plugin tests. Their unused
            // variables and dead code are the thing under test.
            'tests/fixtures/**'
        ]
    },

    // Build/tooling configs inside apps/ run in Node, not the RN bundle.
    {
        files: ['apps/**/*.config.js', 'apps/**/babel.config.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: { ...globals.node }
        },
        rules: { ...js.configs.recommended.rules }
    },

    // ── React Native companion app ───────────────────────────────────────
    {
        files: ['apps/**/*.js', 'apps/**/*.jsx'],
        ignores: ['apps/**/*.config.js', 'apps/**/babel.config.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: { ...globals.browser }
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]' }]
        }
    },

    // ── Backend / Node (CommonJS) ────────────────────────────────────────
    {
        files: ['backend/**/*.js', 'shared/**/*.js', 'plugins/**/*.js', 'scripts/**/*.js', 'electron/**/*.js', 'bin/**/*.js', 'server.js', 'start.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: { ...globals.node }
        },
        rules: {
            ...js.configs.recommended.rules,

            // Unused vars are usually a leftover or a typo, but intentionally
            // ignored callback args are idiomatic — allow a leading underscore.
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],

            // The audit found 8 empty catch blocks that discarded the reason a
            // thing failed. Allow it only when explicitly commented.
            'no-empty': ['error', { allowEmptyCatch: false }],

            // Security-adjacent correctness.
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-return-await': 'error',
            'require-atomic-updates': 'warn',
            'no-unsafe-optional-chaining': 'error',
            'no-constant-binary-expression': 'error',
            eqeqeq: ['warn', 'smart'],

            // Warn, not error: this codebase initialises `let` bindings before a
            // try/catch that assigns them. The initialiser is technically dead
            // when the catch returns early, but it documents the intended shape
            // and guards future edits — a deliberate pattern, not an oversight.
            'no-useless-assignment': 'warn',

            // Backend services must log through Logger so output reaches
            // runtime.log. A console call here is invisible to support. See the
            // override below for the entry points where console IS correct.
            'no-console': 'warn'
        }
    },

    // CLI entry points and the logger's own sink: console is the correct output
    // channel here, not a mistake. `yodaman doctor` printing "✅ Graphify is
    // installed" to the terminal is the feature.
    {
        files: ['bin/**/*.js', 'start.js', 'backend/infrastructure/Logger.js', 'scripts/**/*.js'],
        rules: { 'no-console': 'off' }
    },

    // Electron main process: these calls relay the managed runtime's stdout/stderr
    // to the terminal. That output is already captured twice — by
    // rememberRuntimeLog() in-memory for the diagnostics window, and by the
    // runtime's own file sink. Routing it through Logger would double-write
    // every runtime line into runtime.log.
    {
        files: ['electron/**/*.js'],
        rules: { 'no-console': 'off' }
    },

    // ── Frontend (ESM + JSX + browser) ───────────────────────────────────
    {
        files: ['src/**/*.js', 'src/**/*.jsx', 'frontend/**/*.js', 'frontend/**/*.jsx'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: { ...globals.browser, __APP_VERSION__: 'readonly' }
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
                varsIgnorePattern: '^[A-Z_]'
            }],
            'no-empty': ['error', { allowEmptyCatch: false }],
            'no-eval': 'error',
            eqeqeq: ['warn', 'smart']
        }
    },

    // ── Tests ────────────────────────────────────────────────────────────
    {
        files: ['tests/**/*.js', 'tests/**/*.jsx'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: { ...globals.node, ...globals.jest }
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    }
];
