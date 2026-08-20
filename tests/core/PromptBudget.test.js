/**
 * 9B is the floor YodaMan supports, not the ceiling.
 *
 * The bug these guard: the agent compacted hard for small windows and every
 * other case fell through to a flat 9,000-character budget, so a 32B model
 * served at 131,072 tokens got the same prompt as a 9B served at 8,192 — about
 * 2% of the window, with the rest unused. Running a bigger model bought
 * nothing.
 *
 * The risk in fixing it is the opposite failure: spending a budget the server
 * cannot actually hold. llama-server runs with --context-shift, which drops
 * from the FRONT, so an overflow silently removes the system prompt carrying
 * the tool instructions and the model answers with citations and no tool call.
 * That is why the floors, the cap, and the refusal to trust a declared maximum
 * are all asserted here.
 */
const {
    promptBudgetFor,
    MIN_PROMPT_CHARS,
    MAX_PROMPT_CHARS,
    MIN_ENTRY_CHARS,
    MAX_ENTRY_CHARS
} = require('../../backend/core/promptBudget');

describe('prompt budget', () => {
    describe('never regresses below what existed before it', () => {
        it.each([
            ['unknown', null],
            ['undefined', undefined],
            ['zero', 0],
            ['negative', -1],
            ['not a number', 'lots'],
            ['a small VRAM-chosen window', 4096]
        ])('%s yields the historical floor', (_label, value) => {
            const budget = promptBudgetFor(value);
            expect(budget.maxPromptChars).toBe(MIN_PROMPT_CHARS);
            expect(budget.maxEntryChars).toBe(MIN_ENTRY_CHARS);
        });
    });

    describe('scales with the window', () => {
        it('gives a larger window a larger budget', () => {
            const small = promptBudgetFor(16384);
            const large = promptBudgetFor(65536);
            expect(large.maxPromptChars).toBeGreaterThan(small.maxPromptChars);
            expect(large.maxEntryChars).toBeGreaterThan(small.maxEntryChars);
        });

        it('is monotonic — more window is never less budget', () => {
            const windows = [null, 4096, 8192, 16384, 32768, 65536, 131072, 262144];
            const budgets = windows.map((w) => promptBudgetFor(w).maxPromptChars);
            for (let i = 1; i < budgets.length; i += 1) {
                expect(budgets[i]).toBeGreaterThanOrEqual(budgets[i - 1]);
            }
        });

        it('actually uses a big window rather than falling through to the floor', () => {
            // The whole point: 131,072 tokens must not produce the 9B figure.
            expect(promptBudgetFor(131072).maxPromptChars).toBeGreaterThan(MIN_PROMPT_CHARS * 10);
        });
    });

    describe('stays inside what the server can hold', () => {
        it('never exceeds the single-invocation limit ContextEngine enforces', () => {
            // ContextEngine throws above MAX_PROMPT_CHARS, so a larger budget
            // would only produce a rejected request.
            for (const window of [131072, 262144, 1000000, Number.MAX_SAFE_INTEGER]) {
                expect(promptBudgetFor(window).maxPromptChars).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
            }
        });

        it('caps the per-entry clip', () => {
            expect(promptBudgetFor(1000000).maxEntryChars).toBeLessThanOrEqual(MAX_ENTRY_CHARS);
        });

        it('leaves most of the window for retrieved chunks and the answer', () => {
            // ctx prepends its chunks on top of whatever we send. Claiming the
            // whole window for our own prompt is what overflows it.
            const window = 32768;
            const charsInWindow = window * 3.5;
            expect(promptBudgetFor(window).maxPromptChars).toBeLessThan(charsInWindow * 0.5);
        });

        it('keeps a single tool result from filling the prompt on its own', () => {
            for (const window of [16384, 32768, 131072]) {
                const budget = promptBudgetFor(window);
                expect(budget.maxEntryChars).toBeLessThan(budget.maxPromptChars);
            }
        });
    });
});

describe('ConversationBuffer honours the budget', () => {
    const ConversationBuffer = require('../../backend/core/ConversationBuffer');

    it('defaults to the historical values when nothing is passed', () => {
        // Callers that do not opt in must behave exactly as they did before.
        const buffer = new ConversationBuffer({ system: 's', task: 't' });
        expect(buffer.maxPromptChars).toBe(ConversationBuffer.DEFAULT_MAX_PROMPT_CHARS);
        expect(buffer.maxEntryChars).toBe(ConversationBuffer.MAX_ENTRY_CHARS);
    });

    it('lets a large window keep more of a single tool result verbatim', () => {
        const big = promptBudgetFor(131072);
        const buffer = new ConversationBuffer({
            system: 's',
            task: 't',
            maxPromptChars: big.maxPromptChars,
            maxEntryChars: big.maxEntryChars
        });
        const smallBuffer = new ConversationBuffer({ system: 's', task: 't' });
        expect(buffer.entryCap()).toBeGreaterThan(smallBuffer.entryCap());
    });
});

/**
 * The README tells users which context window to set for their model and what
 * YodaMan will send at each one. Those are numeric claims about this module's
 * behaviour, and nothing else checks them — documentation drifting away from
 * code is the same class of bug as the four ignore lists that drifted apart.
 */
describe('the README\'s documented figures are true', () => {
    const fs = require('fs');
    const path = require('path');
    const readme = fs.readFileSync(path.join(__dirname, '..', '..', 'README.md'), 'utf8');

    /** [window the user sets, the approximate figure the README promises] */
    const DOCUMENTED = [
        [8192, 10000],
        [16384, 20000],
        [32768, 40000],
        [65536, 80000],
        [131072, 120000]
    ];

    it.each(DOCUMENTED)('a %i-token window really does send about %i characters', (window, claimed) => {
        const actual = promptBudgetFor(window).maxPromptChars;
        // Within 5%: the README rounds, but it must not mislead.
        expect(Math.abs(actual - claimed) / claimed).toBeLessThan(0.05);
    });

    it.each(DOCUMENTED)('the README actually mentions the %i window', (window) => {
        expect(readme).toContain(String(window));
    });

    it('only recommends windows the Dashboard will accept', () => {
        // Telling someone to set a value the settings endpoint rejects sends
        // them to a dead end. No fallback default here on purpose: an earlier
        // draft read a name this module does not export and quietly compared
        // against a literal, so it asserted nothing while reporting green.
        const { ALLOWED_VALUES } = require('../../backend/infrastructure/OllamaConfig');
        expect(Array.isArray(ALLOWED_VALUES)).toBe(true);
        for (const [window] of DOCUMENTED) {
            expect(ALLOWED_VALUES).toContain(window);
        }
    });
});

