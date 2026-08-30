#!/usr/bin/env node
/**
 * YodaMan as an MCP server — the three pillars, offered to any agent.
 *
 * Cursor, Claude Code and Zed have strong models and no idea what is in your
 * private codebase. YodaMan has a local index of exactly that: Context Expert's
 * semantic search, Graphify's dependency graph, and OpenSpec's record of what
 * was specified. This exposes that over stdio, so those tools can ask — while
 * the code stays on the machine.
 *
 * Two deliberate design decisions:
 *
 * 1. EVERY TOOL IS READ-ONLY. YodaMan's approval gate protects writes made by
 *    YodaMan's own agent. A client on the other side of this boundary does not
 *    run that gate and cannot be made to, so nothing here writes, patches, or
 *    executes. Offering a write tool would be handing out a key to a door we
 *    stopped locking.
 *
 * 2. IT PROXIES THE LOCAL RUNTIME, it does not re-implement it. Search ranking
 *    blends four signals and lives behind an Express route; a second
 *    implementation here would drift from the first, which is precisely the
 *    failure that cost a descriptor leak when one ignore list became four. If
 *    the runtime is not up, this says so rather than answering from a lesser
 *    copy of itself.
 *
 * Transport is stdio, so nothing listens on a port and nothing leaves the
 * machine. stdout belongs to the protocol — every diagnostic goes to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));

const PORT = Number(process.env.YODAMAN_PORT) || 3090;
const RUNTIME = process.env.YODAMAN_URL || `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = Number(process.env.YODAMAN_MCP_TIMEOUT) || 120000;

/** Protocol output is stdout; anything else would corrupt the stream. */
const note = (message) => process.stderr.write(`[yodaman-mcp] ${message}\n`);

/**
 * One place where "the runtime is not running" becomes a sentence a person can
 * act on. An MCP client surfaces this text directly to the model and often to
 * the user, so it names the fix rather than the failure.
 */
/**
 * Who this server is answering for, learned during the MCP handshake.
 *
 * Every request the proxy makes is an ordinary HTTP call to 127.0.0.1, so
 * without this the runtime cannot tell an agent's query from the web UI's own
 * fetch — and "which agents have read my codebase" is a question a local-first
 * tool should be able to answer.
 *
 * The client states its own name in `initialize`; this is that value, not a
 * guess. Null until the handshake completes, and null forever for a client that
 * declines to identify itself.
 */
function clientLabel() {
    try {
        const info = server.server.getClientVersion();
        if (!info?.name) return null;
        return info.version ? `${info.name}/${info.version}` : info.name;
    } catch (_err) {
        // Before the handshake, or an SDK that does not expose it. Not knowing
        // is a fine answer; inventing one is not.
        return null;
    }
}

async function call(pathname, { method = 'GET', body } = {}) {
    const label = clientLabel();
    let response;
    try {
        response = await fetch(`${RUNTIME}${pathname}`, {
            method,
            headers: {
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                // Identity only. Never the query, never the results — the point
                // is to show WHO looked, not to build a record of what they
                // asked, which would be surveillance of the user's own work.
                ...(label ? { 'X-YodaMan-MCP-Client': label } : {})
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
    } catch (err) {
        const reason = err?.name === 'TimeoutError'
            ? `the runtime did not answer within ${Math.round(TIMEOUT_MS / 1000)}s`
            : `the runtime at ${RUNTIME} is not reachable`;
        throw new Error(
            `${reason}. Start YodaMan (open the desktop app, or run \`yodaman start\`), `
            + 'then try again. Nothing was read.'
        );
    }

    if (!response.ok) {
        let detail = '';
        try {
            const payload = await response.json();
            detail = payload?.error ? ` — ${payload.error}` : '';
        } catch (_err) {
            // A non-JSON error body tells us nothing extra; the status carries it.
        }
        throw new Error(`YodaMan returned HTTP ${response.status} for ${pathname}${detail}`);
    }

    return response.json();
}

/** MCP wants content blocks; JSON is the honest shape for structured results. */
const asResult = (payload) => ({
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
});

const server = new McpServer({ name: 'yodaman', version });

const project = z.string().describe(
    'Absolute path to the workspace. Use yodaman_projects to list indexed workspaces.'
);

server.registerTool('yodaman_projects', {
    title: 'List indexed workspaces',
    description:
        'Workspaces YodaMan has indexed, with whether each is indexed and how fresh it is. '
        + 'Call this first — every other tool needs an absolute workspace path.',
    inputSchema: {}
}, async () => {
    const payload = await call('/api/projects');
    const list = Array.isArray(payload) ? payload : payload.projects || [];
    return asResult(list.map((entry) => ({
        path: entry.path,
        indexed: Boolean(entry.indexed),
        files: entry.files ?? null
    })));
});

server.registerTool('yodaman_search', {
    title: 'Search code by meaning',
    description:
        'Semantic search over an indexed workspace, ranked by four signals rather than text alone: '
        + 'semantic similarity, proximity to the file you are working in, centrality in the '
        + 'dependency graph, and spec coverage. Prefer this over grep when the question is about '
        + 'behaviour or intent rather than an exact string.',
    inputSchema: {
        query: z.string().describe('Natural language, or a code fragment.'),
        project,
        activeFile: z.string().optional().describe(
            'File currently being worked on. Boosts results near it in the dependency graph.'
        ),
        top: z.number().int().min(1).max(50).optional().describe('Max results (default 10).')
    }
}, async ({ query, project: path, activeFile, top }) => {
    const params = new URLSearchParams({ query, project: path });
    if (activeFile) params.set('activeFile', activeFile);
    if (top) params.set('top', String(top));

    const payload = await call(`/api/search?${params}`);
    return asResult({
        results: payload.results || [],
        // Say plainly when ranking could not contribute, rather than implying
        // four signals were used when the answer is semantic-only ordering.
        graphRanked: Boolean(payload.graphRanked),
        weights: payload.weights || null
    });
});

server.registerTool('yodaman_graph_query', {
    title: 'Query the knowledge graph',
    description:
        'Ask the Graphify knowledge graph about relationships between code, docs and diagrams — '
        + 'what calls what, what belongs together, how a concept is spread across files.',
    inputSchema: {
        query: z.string().describe('What to ask the graph.'),
        project
    }
}, async ({ query, project: path }) => asResult(
    await call('/api/graphify/query', { method: 'POST', body: { query, path } })
));

server.registerTool('yodaman_impact', {
    title: 'What a change would affect',
    description:
        'Before editing: what depends on this file or symbol, how far the effect reaches, and '
        + 'which tests cover it. A diff says what changed; this says what it costs.',
    inputSchema: {
        node: z.string().describe('File path or graph node id to assess.'),
        project,
        depth: z.number().int().min(1).max(4).optional().describe('Hops to follow (default 2).')
    }
}, async ({ node, project: path, depth }) => asResult(
    await call('/api/graphify/affected', { method: 'POST', body: { node, path, depth: depth || 2 } })
));

server.registerTool('yodaman_spec_drift', {
    title: 'Where the code and its specs disagree',
    description:
        'OpenSpec intent measured against the graph: specs citing files that no longer exist, and '
        + 'load-bearing modules no spec describes. This is what YodaMan knows that a model reading '
        + 'the repository cannot work out on its own.',
    inputSchema: {
        project,
        minDependents: z.number().int().min(1).optional().describe(
            'Only report undocumented modules with at least this many dependents (default 2).'
        )
    }
}, async ({ project: path, minDependents }) => {
    const params = new URLSearchParams({ projectRoot: path });
    if (minDependents) params.set('minDependents', String(minDependents));
    return asResult(await call(`/api/stardust/drift?${params}`));
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    note(`v${version} ready on stdio, proxying ${RUNTIME} (read-only)`);
}

main().catch((err) => {
    note(`failed to start: ${err.message}`);
    process.exit(1);
});
