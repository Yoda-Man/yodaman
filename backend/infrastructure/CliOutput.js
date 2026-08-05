/**
 * CliOutput — text cleanup for CLI stdout that is shown to users.
 *
 * Kept separate from ContextEngine so that tests which mock the ctx wrapper
 * still get the real cleaning behaviour, and so the rules can be unit tested
 * without spawning a process.
 */

// The ctx CLI prints a startup banner and progress chatter to stdout before the
// answer. `executeJson` skips past it to find the JSON block, but `ask` returns
// prose, so the banner would otherwise be shown as part of the answer.
// Citation lines ("Sources:", "[1] path (0.88)") are deliberately kept.
const CLI_NOISE_PATTERNS = [
    /^[◇◆○●]\s/,                       // env-injection banner glyphs
    /^\s*injected env\b/i,
    /^\s*tip:/i,
    /^\s*Searching\b.*\.\.\.\s*$/i,     // "Searching <project>..."
    /^\s*Indexing\b.*\.\.\.\s*$/i,
    /^\s*Loading\b.*\.\.\.\s*$/i
];

/**
 * Strip CLI banner and progress lines from prose output.
 *
 * Only removes lines matching a known-noise pattern, and only trims blank lines
 * left at the very start — answer content is never reflowed.
 *
 * @param {string} output Raw stdout from the CLI.
 * @returns {string} The answer text with CLI chrome removed.
 */
function stripCliNoise(output) {
    const lines = String(output ?? '').split('\n');
    const kept = lines.filter(line => !CLI_NOISE_PATTERNS.some(pattern => pattern.test(line)));

    // Drop blank lines the removed banner left behind at the top.
    while (kept.length && !kept[0].trim()) kept.shift();

    const cleaned = kept.join('\n').trimEnd();
    // If filtering removed everything, the output was pure chrome — fall back to
    // the original so a real (unrecognized) answer is never swallowed.
    return cleaned || String(output ?? '').trim();
}

/**
 * The most informative line of a ctx failure.
 *
 * ctx writes Node deprecation warnings to stderr ahead of any real diagnostic, so
 * taking the first line reports `DeprecationWarning: punycode is deprecated`
 * instead of the actual cause. Prefer a line that names an error.
 *
 * @param {string} stderr Raw stderr from the CLI.
 * @returns {string} One line describing the failure.
 */
function summarizeCliError(stderr) {
    const lines = String(stderr ?? '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !/DeprecationWarning|--trace-deprecation|--trace-warnings|ExperimentalWarning/.test(line));

    return lines.find(line => /^(Error|error|FATAL|Failed)\b/.test(line))
        || lines.find(line => /error|failed|cannot|refused/i.test(line))
        || lines[0]
        || 'the CLI exited without a diagnostic';
}

/**
 * Does this output contain an actual answer, or only citations?
 *
 * `ctx ask` prints the RAG citation block ("Sources:" followed by "[1] path
 * (0.88)" lines) whether or not the model produced any prose. When generation
 * yields nothing — which happens intermittently, and reliably when the model
 * begins emitting a tool call — the result is a bare citation list. That is
 * indistinguishable from a real answer to anything that only checks for a
 * non-empty string, so the agent used to accept it as the final answer and the
 * user saw a list of filenames as their response.
 *
 * Citations are still shown to the user; this only reports whether they are all
 * there is.
 *
 * @param {string} output Cleaned CLI output.
 * @returns {boolean} True when there is prose beyond the citation block.
 */
function hasSubstantiveAnswer(output) {
    const text = String(output ?? '');
    // Everything before the citation block is the answer.
    const prose = text.split(/^\s*Sources:\s*$/m)[0];
    // Drop any stray citation lines that appear without the header.
    const withoutCitations = prose
        .split('\n')
        .filter(line => !/^\s*\[\d+\]\s+\S+\s+\([\d.]+\)\s*$/.test(line))
        .join('\n');
    return withoutCitations.trim().length > 0;
}

module.exports = { stripCliNoise, hasSubstantiveAnswer, summarizeCliError, CLI_NOISE_PATTERNS };
