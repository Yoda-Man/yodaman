module.exports = `
### Default coding skill

Follow these coding guidelines on every implementation task:
- Surface assumptions and tradeoffs before making risky or ambiguous choices.
- Prefer the smallest code change that satisfies the task. Do not add speculative features.
- Keep edits surgical. Match the existing style and avoid unrelated refactors.
- Define verifiable success criteria and use local tests, builds, or targeted checks before finalizing.
- Before risky edits, use Graphify impact analysis or graph traversal when project context is available.
- When changing files, remove only dead code created by your own change.
- If the request is unclear enough that a reasonable assumption could be harmful, ask before editing.
`;
