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

### OpenSpec workflow (Propose → Validate → Apply → Archive)

For any significant feature or structural change, follow the OpenSpec workflow:
1. **Propose**: Call specPropose(project, changeName, description) to create proposal.md, design.md, and tasks.md.
2. **Validate**: After implementing, call specValidate(project, changeName) to check the change against project specs.
3. **Archive**: Once validated and complete, call specArchive(project, changeName) to finalize.

Before proposing, check existing drift with specDrift(project) to avoid duplicating undocumented work.
For simple bug fixes or single-file edits, skip the workflow — use it for features that touch multiple files or introduce new patterns.
`;
