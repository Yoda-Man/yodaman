/**
 * Which agents have read this workspace, and — more importantly — what is not
 * kept about them.
 *
 * YodaMan's promise is that code never leaves the machine. Showing who read it
 * is the natural extension of that. But a record of what an agent ASKED about
 * your codebase is a record of what you were working on, and that is
 * surveillance wearing a transparency badge. The privacy block below is the
 * point of this file: it fails if queries, arguments, or file paths ever start
 * being stored.
 *
 * The header is also attacker-controllable in principle — any process that can
 * reach 127.0.0.1 can set it — so the bounds are asserted rather than assumed.
 */
const mcpClients = require('../../backend/infrastructure/McpClients');

describe('MCP client visibility', () => {
    beforeEach(() => mcpClients.reset());

    describe('records identity, counts, and time', () => {
        it('aggregates repeat requests from one client', () => {
            mcpClients.record('cursor/0.42');
            mcpClients.record('cursor/0.42');
            mcpClients.record('cursor/0.42');

            const [entry] = mcpClients.list();
            expect(entry.label).toBe('cursor/0.42');
            expect(entry.calls).toBe(3);
        });

        it('keeps clients distinct, most recently seen first', () => {
            // Both land in the same millisecond, which is exactly the case that
            // used to be ambiguous: ordering on the timestamp alone left this to
            // chance, and it passed alone while failing in a full run. Ordering
            // is now by arrival sequence, so it holds regardless of the clock.
            mcpClients.record('claude-code/2.1');
            mcpClients.record('cursor/0.42');

            const labels = mcpClients.list().map((c) => c.label);
            expect(labels).toHaveLength(2);
            expect(labels[0]).toBe('cursor/0.42');
        });

        it('orders deterministically across many same-millisecond runs', () => {
            // The guard for the flake itself. One pass proves little when the
            // failure was timing-dependent.
            for (let i = 0; i < 200; i += 1) {
                mcpClients.reset();
                mcpClients.record('first');
                mcpClients.record('second');
                expect(mcpClients.list()[0].label).toBe('second');
            }
        });

        it('a repeat request moves a client back to the top', () => {
            mcpClients.record('cursor/0.42');
            mcpClients.record('claude-code/2.1');
            mcpClients.record('cursor/0.42');
            expect(mcpClients.list()[0].label).toBe('cursor/0.42');
        });

        it('reports timestamps a caller can phrase itself', () => {
            mcpClients.record('zed/1.0');
            const [entry] = mcpClients.list();
            // ISO, not "2 minutes ago" — how to phrase age is a presentation
            // decision, and the API should not make it.
            expect(() => new Date(entry.firstSeen).toISOString()).not.toThrow();
            expect(new Date(entry.lastSeen).getTime()).toBeGreaterThan(0);
        });
    });

    describe('stores nothing about what was asked', () => {
        it('keeps only label, calls, and timestamps', () => {
            mcpClients.record('cursor/0.42');
            const [entry] = mcpClients.list();

            // Exact shape, deliberately. A new field here is a privacy decision
            // and should have to be made on purpose. `seq` is internal ordering
            // state and is not exposed.
            expect(Object.keys(entry).sort()).toEqual(['calls', 'firstSeen', 'label', 'lastSeen']);
        });

        it('the module never accepts a query or a path', () => {
            // record() takes one argument. If it ever grows a second, this is
            // where someone has to justify it.
            expect(mcpClients.record.length).toBe(1);
        });

        it('discards anything passed beyond the label', () => {
            mcpClients.record('cursor/0.42', { query: 'how does auth work', file: '/secret.js' });
            const [entry] = mcpClients.list();
            expect(JSON.stringify(entry)).not.toMatch(/auth|secret/);
        });
    });

    describe('bounds a header it does not control', () => {
        it('caps the label length', () => {
            mcpClients.record('x'.repeat(500));
            expect(mcpClients.list()[0].label.length).toBeLessThanOrEqual(mcpClients.MAX_LABEL);
        });

        it('strips control characters that could smuggle terminal escapes', () => {
            const nasty = `evil${String.fromCharCode(27)}[31mred`;
            mcpClients.record(nasty);
            const [entry] = mcpClients.list();
            expect(entry.label).toBe('evil[31mred');
            expect(entry.label.charCodeAt(4)).not.toBe(27);
        });

        it('never grows past the cap, dropping the least recently seen', () => {
            for (let i = 0; i < mcpClients.MAX_CLIENTS + 10; i += 1) {
                mcpClients.record(`client-${i}`);
            }
            expect(mcpClients.list().length).toBeLessThanOrEqual(mcpClients.MAX_CLIENTS);
            // The newest survived; the oldest did not.
            const labels = mcpClients.list().map((c) => c.label);
            expect(labels).toContain(`client-${mcpClients.MAX_CLIENTS + 9}`);
            expect(labels).not.toContain('client-0');
        });

        it.each([[''], ['   '], [null], [undefined], [42], [{}]])(
            'ignores %p rather than recording an empty client',
            (value) => {
                mcpClients.record(value);
                expect(mcpClients.list()).toHaveLength(0);
            }
        );
    });

    describe('middleware never blocks a request', () => {
        const run = (headers) => {
            const next = jest.fn();
            mcpClients.middleware({ headers }, {}, next);
            return next;
        };

        it('records the header when present', () => {
            expect(run({ [mcpClients.CLIENT_HEADER]: 'cursor/0.42' })).toHaveBeenCalled();
            expect(mcpClients.list()[0].label).toBe('cursor/0.42');
        });

        it('passes through when the header is absent', () => {
            expect(run({})).toHaveBeenCalled();
            expect(mcpClients.list()).toHaveLength(0);
        });

        it('passes through even when the request is malformed', () => {
            // Visibility must never be the reason a request fails.
            const next = jest.fn();
            mcpClients.middleware(null, {}, next);
            expect(next).toHaveBeenCalled();
        });
    });

    describe('the MCP server actually sends the header', () => {
        const fs = require('fs');
        const path = require('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', 'bin', 'yodaman-mcp.mjs'), 'utf8'
        );

        it('sets the identity header the runtime reads', () => {
            // Both halves must agree, or the panel silently shows nothing —
            // the same drift that made four ignore lists diverge.
            expect(source).toMatch(/X-YodaMan-MCP-Client/);
            expect(mcpClients.CLIENT_HEADER).toBe('x-yodaman-mcp-client');
        });

        it('takes the name from the handshake rather than guessing', () => {
            expect(source).toMatch(/getClientVersion\(\)/);
        });

        it('sends no query or result data in headers', () => {
            // The header carries a label. If someone adds the query here to
            // "improve" the panel, this is where it gets caught.
            //
            // Comments are stripped first: the prose in that block explains
            // that it never sends the query, and the word "query" appearing in
            // that explanation is not the same as sending one. An earlier
            // version of this test failed on its own documentation.
            const block = source
                .slice(source.indexOf('headers: {'), source.indexOf('body: body'))
                .split('\n')
                .filter((line) => !line.trim().startsWith('//'))
                .join('\n');

            expect(block).not.toMatch(/query|pathname|arguments|results/);
            // What it DOES send, so this cannot pass by the block being empty.
            expect(block).toMatch(/X-YodaMan-MCP-Client/);
        });
    });
});
