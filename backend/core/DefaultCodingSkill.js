/**
 * The standing coding guidance, appended to every system prompt.
 *
 * Kept tight on purpose. This block is re-sent on every reasoning step of every
 * task, and the model's usable prompt size is the binding constraint on answer
 * quality — measured against the shipped local model, answers degrade past ~9,000
 * characters of prompt and collapse by 12,000. Anything here that the typed tool
 * descriptions already say is therefore pure cost: the four-step OpenSpec sequence
 * used to be spelled out here *and* in the system prompt *and* in the
 * specPropose/specValidate/specArchive descriptions.
 *
 * Guidance that is genuinely about judgement stays. Restatements of a tool's own
 * contract belong in that tool's description.
 */
module.exports = `
### Default coding skill

- Surface assumptions and tradeoffs before making risky or ambiguous choices.
- Prefer the smallest change that satisfies the task. No speculative features.
- Keep edits surgical: match the existing style, avoid unrelated refactors, and remove only dead code your own change created.
- Define verifiable success criteria, and run local tests or targeted checks before finalizing.
- If the request is unclear enough that a reasonable assumption could be harmful, ask before editing.

### OpenSpec

Use the Propose → Validate → Archive tools for features touching multiple files or
introducing new patterns; skip them for single-file fixes. Check specDrift first so
you do not re-implement something a spec already describes.
`;
