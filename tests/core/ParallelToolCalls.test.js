/**
 * The agent used to throw away every tool call after the first.
 *
 * `AgentReasoningEngine` extracted tool calls with a NON-GLOBAL regex:
 *
 *     response.match(/<tool_call>([\s\S]*?)<\/tool_call>/)
 *
 * `String.match` without `g` returns the first match only. A model emitting
 * three reads had two discarded — no error, no log line, nothing in the task
 * events. Reproduced against the live matcher before the fix:
 *
 *     blocks emitted   : 3
 *     blocks returned  : 1
 *     silently dropped : b.js, c.js
 *
 * WHAT IT COST, precisely: usually not lost work — wasted iterations. The model
 * saw one result, re-emitted the rest, and three calls consumed three turns
 * instead of one. Against `maxIterations = 10` that spends the budget about
 * three times faster than the work needs, and a task requiring a dozen file
 * reads ended on "I reached the maximum number of steps without finishing."
 * From outside it looked like the agent gave up, not like it had discarded two
 * thirds of its own requests.
 *
 * WHAT THESE TESTS PROTECT:
 *
 *   1. Every call is extracted, in the order the model wrote it.
 *   2. Nothing is EVER dropped silently again — malformed and over-cap calls
 *      are reported, because silence is the actual defect.
 *   3. Parallelism stops at the approval gate. Reads may run together; anything
 *      needing consent stays on the one-at-a-time path, so a user is never
 *      asked to approve several changes at once.
 */
const engine = require('../../backend/core/AgentReasoningEngine');
const { extractToolCalls, MAX_PARALLEL_TOOL_CALLS } = engine;
const { requiresApproval } = require('../../shared/toolCapabilities');

const wrap = (name, params) =>
    `<tool_call>${JSON.stringify({ name, parameters: params })}</tool_call>`;
const wireForm = (name, params) =>
    `TOOL_CALL ${JSON.stringify({ name, parameters: params })}\n`;

describe('extracting every tool call', () => {
    it('returns all three, not just the first', () => {
        // The regression. This is the assertion the old matcher failed.
        const response = [
            'I need three files.',
            wrap('readFile', { filePath: 'a.js' }),
            wrap('readFile', { filePath: 'b.js' }),
            wrap('readFile', { filePath: 'c.js' })
        ].join('\n');

        const { calls } = extractToolCalls(response);
        expect(calls).toHaveLength(3);
    });

    it('preserves the order the model wrote them in', () => {
        const response = ['a.js', 'b.js', 'c.js'].map((f) => wrap('readFile', { filePath: f })).join('\n');
        const paths = extractToolCalls(response).calls.map((c) => c.call.parameters.filePath);
        expect(paths).toEqual(['a.js', 'b.js', 'c.js']);
    });

    it('is deterministic across repeated runs', () => {
        // Ordering is load-bearing: ConversationBuffer.addToolResult appends,
        // so an unstable order would show the model a different history for
        // identical work. One pass proves little for an ordering property.
        const response = ['a.js', 'b.js', 'c.js', 'd.js'].map((f) => wrap('readFile', { filePath: f })).join('\n');
        for (let i = 0; i < 200; i += 1) {
            const paths = extractToolCalls(response).calls.map((c) => c.call.parameters.filePath);
            expect(paths).toEqual(['a.js', 'b.js', 'c.js', 'd.js']);
        }
    });

    it('handles the TOOL_CALL wire form too', () => {
        const response = wireForm('readFile', { filePath: 'a.js' }) + wireForm('listFiles', { directoryPath: '.' });
        expect(extractToolCalls(response).calls).toHaveLength(2);
    });

    it('orders by position when both delimiter forms appear', () => {
        // Concatenating the two match sets would order by delimiter rather
        // than by what the model actually wrote.
        const response = [
            wrap('readFile', { filePath: 'first.js' }),
            wireForm('readFile', { filePath: 'second.js' }),
            wrap('readFile', { filePath: 'third.js' })
        ].join('\n');

        const paths = extractToolCalls(response).calls.map((c) => c.call.parameters.filePath);
        expect(paths).toEqual(['first.js', 'second.js', 'third.js']);
    });

    it('still handles a single call', () => {
        const { calls } = extractToolCalls(wrap('readFile', { filePath: 'a.js' }));
        expect(calls).toHaveLength(1);
        expect(calls[0].call.name).toBe('readFile');
    });

    it('returns nothing for prose with no tool call', () => {
        expect(extractToolCalls('Here is my answer, no tools needed.').calls).toHaveLength(0);
    });

    it.each([[''], ['   '], [null], [undefined], [42], [{}]])(
        'survives %p without throwing', (value) => {
            expect(() => extractToolCalls(value)).not.toThrow();
            expect(extractToolCalls(value).calls).toHaveLength(0);
        });
});

describe('nothing is dropped silently', () => {
    it('reports a malformed block instead of discarding it', () => {
        const response = [
            wrap('readFile', { filePath: 'a.js' }),
            '<tool_call>{ this is not json </tool_call>'
        ].join('\n');

        const { calls, malformed } = extractToolCalls(response);
        expect(calls).toHaveLength(1);
        expect(malformed).toHaveLength(1);
    });

    it('runs the valid calls even when one block is malformed', () => {
        // The precise failure to avoid reintroducing: one bad block must not
        // take the good ones down with it.
        const response = [
            wrap('readFile', { filePath: 'a.js' }),
            '<tool_call>{ broken </tool_call>',
            wrap('readFile', { filePath: 'c.js' })
        ].join('\n');

        const paths = extractToolCalls(response).calls.map((c) => c.call.parameters.filePath);
        expect(paths).toEqual(['a.js', 'c.js']);
    });

    it('repairs the malformations the 9B models actually produce', () => {
        // Trailing comma — common enough that a repair step already existed.
        const response = '<tool_call>{"name":"readFile","parameters":{"filePath":"a.js"},}</tool_call>';
        expect(extractToolCalls(response).calls).toHaveLength(1);
    });

    it('rejects a block with no tool name rather than passing it on', () => {
        const response = '<tool_call>{"parameters":{"filePath":"a.js"}}</tool_call>';
        const { calls, malformed } = extractToolCalls(response);
        expect(calls).toHaveLength(0);
        expect(malformed).toHaveLength(1);
    });

    it('caps the batch but reports the true total', () => {
        // total must exceed calls.length, or the caller cannot tell the
        // difference between "ran everything" and "ran the first five".
        const response = Array.from({ length: 10 }, (_, i) => wrap('readFile', { filePath: `f${i}.js` })).join('\n');
        const { calls, total } = extractToolCalls(response);

        expect(calls).toHaveLength(MAX_PARALLEL_TOOL_CALLS);
        expect(total).toBe(10);
        expect(total).toBeGreaterThan(calls.length);
    });
});

describe('parallelism stops at the approval gate', () => {
    // The engine decides via requiresApproval(). These assert the classification
    // the engine relies on, so a change to the allowlist that would silently
    // start batching writes fails here.
    const namesOf = (response) => extractToolCalls(response).calls.map((c) => c.call.name);

    it('a batch of reads is entirely gate-free', () => {
        const response = [
            wrap('readFile', { filePath: 'a.js' }),
            wrap('searchCode', { query: 'auth' }),
            wrap('graphifyQuery', { query: 'deps' })
        ].join('\n');

        for (const name of namesOf(response)) {
            expect(requiresApproval(name, {})).toBe(false);
        }
    });

    it('a batch containing a write is NOT gate-free', () => {
        // This is what forces the engine onto the sequential path, so a user is
        // never shown several pending changes at once.
        const response = [
            wrap('readFile', { filePath: 'a.js' }),
            wrap('writeFile', { filePath: 'b.js', content: 'x' })
        ].join('\n');

        const names = namesOf(response);
        expect(names).toContain('writeFile');
        expect(names.some((n) => requiresApproval(n, {}))).toBe(true);
    });

    it('applyPatch is gated too, so a read+patch batch stays sequential', () => {
        // applyPatch writes to disk and was once ungated. If it ever became
        // batchable, several disk writes would land per turn.
        expect(requiresApproval('applyPatch', {})).toBe(true);
    });

    it('an unknown tool is gated, so a new tool cannot join a batch by default', () => {
        expect(requiresApproval('someBrandNewTool', {})).toBe(true);
    });
});
