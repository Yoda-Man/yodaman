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

module.exports = { stripCliNoise, CLI_NOISE_PATTERNS };
