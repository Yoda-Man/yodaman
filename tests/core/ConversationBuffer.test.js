const ConversationBuffer = require('../../backend/core/ConversationBuffer');

const SYSTEM = 'SYSTEM PROMPT';
const TASK = 'refactor the auth middleware';

function makeBuffer(overrides = {}) {
    return new ConversationBuffer({ system: SYSTEM, task: TASK, ...overrides });
}

describe('ConversationBuffer', () => {
    test('renders the system prompt, brief and task', () => {
        const buffer = makeBuffer({ brief: 'STARDUST BRIEF BODY' });
        const prompt = buffer.render();

        expect(prompt).toContain(SYSTEM);
        expect(prompt).toContain('STARDUST BRIEF BODY');
        expect(prompt).toContain(`User Task: ${TASK}`);
    });

    test('clips an oversized tool result and says how much it dropped', () => {
        const buffer = makeBuffer();
        buffer.addToolResult('readFile', { content: 'x'.repeat(50_000) });

        const prompt = buffer.render();
        expect(prompt).not.toContain('x'.repeat(20_000));
        expect(prompt).toMatch(/more characters omitted from the transcript/);
        expect(prompt.length).toBeLessThan(20_000);
    });

    // The property that matters: ctx re-reads the whole prompt every iteration, so
    // an unbounded transcript is paid for again on every step.
    test('holds the history within its budget however many turns arrive', () => {
        const buffer = makeBuffer({ maxPromptChars: 5000 + SYSTEM.length + TASK.length });

        for (let i = 0; i < 40; i++) {
            buffer.addAssistant(`step ${i}`);
            buffer.addToolResult('readFile', { content: 'y'.repeat(2000) });
        }

        buffer.render();
        expect(buffer.historyChars()).toBeLessThanOrEqual(5000);
        expect(buffer.digests.length).toBeGreaterThan(0);
    });

    test('keeps the newest turns verbatim and digests the oldest', () => {
        const buffer = makeBuffer({ maxPromptChars: 4000 + SYSTEM.length + TASK.length });

        buffer.addToolResult('specDrift', { staleCount: 3 });
        for (let i = 0; i < 10; i++) {
            buffer.addToolResult('readFile', { content: 'z'.repeat(1500), marker: `turn-${i}` });
        }

        const prompt = buffer.render();
        expect(prompt).toContain('turn-9');           // newest survives verbatim
        expect(prompt).not.toContain('turn-0');       // oldest was collapsed
        expect(prompt).toContain('Earlier steps in this task');
        expect(prompt).toMatch(/specDrift → ok/);     // but its digest remains
    });

    test('never elides the task itself', () => {
        const buffer = makeBuffer({ maxPromptChars: 200 });
        for (let i = 0; i < 30; i++) buffer.addToolResult('readFile', { content: 'q'.repeat(3000) });

        expect(buffer.render()).toContain(`User Task: ${TASK}`);
    });

    test('digests an error result as an error, not as success', () => {
        const buffer = makeBuffer({ maxPromptChars: 100 });
        buffer.addToolResult('executeCommand', { error: 'shell commands are disabled' });
        for (let i = 0; i < 6; i++) buffer.addToolResult('readFile', { content: 'w'.repeat(500) });

        expect(buffer.render()).toMatch(/executeCommand → error: shell commands are disabled/);
    });

    test('reports what it is sending', () => {
        const buffer = makeBuffer();
        buffer.addAssistant('thinking');
        buffer.addToolResult('readFile', { content: 'hi' });

        const stats = buffer.stats();
        expect(stats.turns).toBe(2);
        expect(stats.digested).toBe(0);
        expect(stats.promptChars).toBeGreaterThan(SYSTEM.length);
    });

    test('a stringifiable non-string result still lands in the transcript', () => {
        const buffer = makeBuffer();
        buffer.addToolResult('impactOf', { risk: 'high', dependentCount: 12 });

        const prompt = buffer.render();
        expect(prompt).toContain('"risk": "high"');
        expect(prompt).toContain('"dependentCount": 12');
    });

    // The budget bounds the whole prompt, not just the history. Answer quality
    // against the configured local model falls off past ~9k characters and
    // collapses by 12k, and the model does not care which part of the prompt was
    // cheap to produce — so a large system prompt or brief has to come out of the
    // same allowance.
    describe('whole-prompt budget', () => {
        test('a large brief shrinks the history allowance rather than the total', () => {
            const small = new ConversationBuffer({ system: SYSTEM, task: TASK, brief: 'b'.repeat(500), maxPromptChars: 6000 });
            const large = new ConversationBuffer({ system: SYSTEM, task: TASK, brief: 'b'.repeat(4000), maxPromptChars: 6000 });

            expect(large.historyBudget()).toBeLessThan(small.historyBudget());
        });

        test('holds the whole prompt inside the budget across many turns', () => {
            const buffer = new ConversationBuffer({
                system: 'S'.repeat(2000),
                brief: 'B'.repeat(1000),
                task: TASK,
                maxPromptChars: 6000,
            });

            for (let i = 0; i < 30; i++) {
                buffer.addAssistant(`reasoning ${i}`);
                buffer.addToolResult('readFile', { content: 'c'.repeat(4000), marker: `m${i}` });
            }

            const prompt = buffer.render();
            expect(prompt.length).toBeLessThanOrEqual(6000);
            expect(buffer.stats().overBudget).toBe(false);
            expect(prompt).toContain(`User Task: ${TASK}`);
        });

        test('reports over-budget instead of hiding it when the fixed parts alone overflow', () => {
            const buffer = new ConversationBuffer({
                system: 'S'.repeat(9000),
                task: TASK,
                maxPromptChars: 4000,
            });
            buffer.addToolResult('readFile', { content: 'x'.repeat(500) });

            const stats = buffer.stats();
            expect(stats.overBudget).toBe(true);
            expect(stats.budget).toBe(4000);
        });

        test('keeps the newest turn even when it alone overflows, clipped', () => {
            const buffer = new ConversationBuffer({ system: SYSTEM, task: TASK, maxPromptChars: 2500 });
            buffer.addToolResult('readFile', { content: 'n'.repeat(50_000) });

            const prompt = buffer.render();
            expect(prompt).toContain('System (Tool Result)');
            expect(prompt).toMatch(/more characters omitted/);
            expect(prompt.length).toBeLessThanOrEqual(2500);
        });

        test('defaults to the measured working size for the shipped model', () => {
            expect(ConversationBuffer.DEFAULT_MAX_PROMPT_CHARS).toBe(9000);
            expect(makeBuffer().maxPromptChars).toBe(9000);
        });
    });
});
