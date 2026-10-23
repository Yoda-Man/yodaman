/**
 * The AI summary under a search: the local model reads what the pipeline
 * returned and answers the query from those results only, citing them.
 *
 * It never retrieves on its own. `ctx ask` would, which bypasses the
 * pipeline's cleaning, Graphify ranking and OpenSpec tags; here the model
 * sees exactly the hits the user sees. It uses the model Context Expert is
 * configured with, so there is no second model setting to keep in step.
 */
const contextEngine = require('../infrastructure/ContextEngine');
const { hitPath, hitLine, hitText } = require('../../shared/searchHits');

const OLLAMA_URL = 'http://127.0.0.1:11434';
const MAX_HITS = 8;
const MAX_SNIPPET_CHARS = 700;
const CACHE_SIZE = 50;

const INSTRUCTIONS = [
    'You summarise code search results for a developer.',
    'Answer the question using only the numbered search results below.',
    'Cite the results you use as [1], [2] and so on.',
    'If the results do not answer the question, say so in one sentence; do not guess.',
    'At most five sentences. Plain text, no headings.'
].join(' ');

/** The user message: the question, then each hit with where it is and what it says. */
function buildPrompt(query, results) {
    const sources = results.slice(0, MAX_HITS).map((hit, i) => {
        const line = hitLine(hit);
        const specs = hit.specFlag?.covered ? ` (described in specs: ${hit.specFlag.specs.join(', ')})` : '';
        return `[${i + 1}] ${hitPath(hit) || 'unknown file'}${line ? `:${line}` : ''}${specs}\n${hitText(hit).slice(0, MAX_SNIPPET_CHARS)}`;
    });
    return `Question: ${query}\n\nSearch results:\n\n${sources.join('\n\n')}`;
}

let modelPromise = null;
/** The model Context Expert answers with, read once from `ctx status`. */
function localModel() {
    modelPromise ??= contextEngine.executeJson(['status']).then((status) => {
        if (status?.llm?.provider !== 'ollama' || !status.llm.model) {
            throw new Error(`Context Expert is not set up with a local Ollama model (found ${status?.llm?.provider || 'none'}).`);
        }
        return status.llm.model;
    });
    // A failed lookup is retried next time rather than remembered.
    modelPromise.catch(() => { modelPromise = null; });
    return modelPromise;
}

// Finished summaries, keyed by model and the exact prompt: the same results
// (same hits, ranking and spec tags) give the same answer without the model.
// Oldest first, so the first key is the one to drop.
const cache = new Map();
function remember(key, text) {
    cache.delete(key);
    cache.set(key, text);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
}

/**
 * Stream the summary as text pieces.
 *
 * @param {object} input
 * @param {string} input.query
 * @param {object[]} input.results  SearchPipeline.search(...).results
 * @param {AbortSignal} [input.signal]  Stops generation when the user moves on.
 * @returns {AsyncGenerator<string>}
 */
async function* summarize({ query, results, signal, fetchImpl = fetch }) {
    const model = await localModel();
    const prompt = buildPrompt(query, results);
    const key = `${model}\n${prompt}`;
    if (cache.has(key)) {
        const text = cache.get(key);
        remember(key, text);
        yield text;
        return;
    }

    const response = await fetchImpl(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        signal,
        body: JSON.stringify({
            model,
            stream: true,
            // Thinking models (qwen3) otherwise reason at length before the first word.
            think: false,
            options: { temperature: 0.2 },
            messages: [
                { role: 'system', content: INSTRUCTIONS },
                { role: 'user', content: prompt }
            ]
        })
    });
    if (!response.ok) throw new Error(`Local model ${model} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);

    // Ollama streams one JSON object per line; a network chunk can end mid-line.
    const decoder = new TextDecoder();
    let buffer = '';
    let written = '';
    let finished = false;
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end).trim();
            buffer = buffer.slice(end + 1);
            if (!line) continue;
            const message = JSON.parse(line);
            if (message.error) throw new Error(message.error);
            if (message.message?.content) {
                written += message.message.content;
                yield message.message.content;
            }
            if (message.done) finished = true;
        }
    }
    // Only a summary the model said it finished is kept, never a cut-off one.
    if (finished && written) remember(key, written);
}

module.exports = { summarize, buildPrompt, localModel, MAX_HITS, CACHE_SIZE };
