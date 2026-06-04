# Graph Studio Design

## Decision

Yodaman will promote Graphify visualization from the Plugins administration area into a first-class, project-scoped **Graph Studio** tab. The first release will embed Graphify's existing generated artifacts while surrounding them with native Yodaman controls for graph status, search, node drill-down, impact analysis, and report reading.

The goal is to create a memorable reveal: when a user selects a project and opens Graph Studio, they see their codebase as an explorable system rather than a list of files.

## Current Context

Graphify is already mandatory in Yodaman and is wired through `backend/infrastructure/GraphifyService.js`, `plugins/graphify.js`, and `/api/graphify/*` routes. The current UI exposes graph status, manual rebuilds, direct graph queries, impact analysis, and a compact architecture map inside `src/components/PluginsWindow.jsx`.

That placement is useful for operations, but it undersells the visualization. Plugins should remain the place to administer plugin health. Graph Studio should become the place to experience and understand the workspace graph.

## Product Experience

Graph Studio adds a new top-level tab beside Chat, Search, Dashboard, Manual, and Plugins. It is enabled when a project is selected in the sidebar. Without a selected project, it shows a focused empty state asking the user to select a workspace.

The first screen should feel cinematic but still practical:

- A full-bleed central graph canvas is the visual anchor.
- A slim left rail provides graph mode, filters, search, freshness, and rebuild actions.
- A right inspector panel shows selected node details, related files, graph explanations, impact analysis, and quick actions.
- A report drawer or secondary tab renders `graph_report.md` in a readable format.

The user flow should be progressive:

1. **Reveal**: open Graph Studio and see the interactive graph.
2. **Focus**: search or click a node to highlight neighbors and filter noise.
3. **Understand**: read the node inspector and Graphify explanation.
4. **Act**: ask Chat about the selected node, run impact analysis, open the markdown report, or export/open the full artifact.

## Integration Strategy

Phase one should embed existing artifacts rather than reimplement Graphify visualizations immediately.

Yodaman should expose controlled runtime routes for Graphify artifacts:

- `GET /api/graphify/artifact?path=<workspace>&type=mindmap` serves `graph.html`.
- `GET /api/graphify/artifact?path=<workspace>&type=visualizer` serves `graph_visualizer.html`.
- `GET /api/graphify/report?path=<workspace>` returns sanitized markdown or rendered HTML for `graph_report.md`.

The UI should use a sandboxed iframe for `graph.html` and `graph_visualizer.html`. The iframe preserves generated interactivity, avoids tight coupling to Graphify's internal HTML, and lets Yodaman ship quickly. A segmented control inside Graph Studio switches between:

- **Mind Map**: `graph.html`, the primary wow moment.
- **Canvas**: `graph_visualizer.html`, the Vis.js network view.
- **Report**: native markdown report reader.
- **Map Preview**: the existing compact `/api/graphify/map` native summary as a fallback or overview.

The native Yodaman shell should own project state, status, rebuilds, report rendering, and Graphify API actions. The generated artifact iframe should own its internal zooming, panning, and canvas interactions.

## Technical Architecture

Backend changes:

- Extend `GraphifyService` with artifact path helpers for `graph.html`, `graph_visualizer.html`, and `graph_report.md`, while retaining the current `GRAPH_REPORT.md` behavior if needed.
- Add API routes that validate the requested workspace path against registered projects before serving any artifact.
- Serve only known artifact types from the selected project's `graphify-out` directory.
- Return `404` when an artifact has not been generated yet and provide enough metadata for the UI to show a build prompt.

Frontend changes:

- Add `GraphStudio.jsx` as a dedicated component.
- Add a `Graph` tab to `App.jsx`, passing `selectedProject`.
- Add API client helpers for artifact URLs and report fetching.
- Move graph status/rebuild/query/impact UX from `PluginsWindow.jsx` into Graph Studio, or duplicate only temporarily if needed for migration.
- Keep Plugins focused on plugin marketplace and mandatory Graphify health status.

Security and embedding:

- Do not expose arbitrary local files by path.
- Use route-level workspace validation before serving artifacts.
- Use iframe sandboxing. The likely minimum is `sandbox="allow-scripts allow-same-origin"` if generated assets need same-origin behavior. Avoid `allow-top-navigation`, `allow-forms`, and `allow-popups` unless a specific artifact needs them.
- Current global CSP blocks inline scripts through `script-src 'self'`, while generated HTML often includes inline scripts. Artifact routes may need a narrower, route-specific CSP that allows the generated visualization to run inside the iframe without weakening the main app.
- Keep artifact content isolated from React state. If later communication is needed, use `postMessage` with strict origin and message shape checks.

Performance:

- Lazy-load iframe content only when Graph Studio opens.
- Avoid loading both generated HTML artifacts at once; load the active mode only.
- Use the compact `/api/graphify/map` response for quick initial stats and empty/fallback states.
- Show graph freshness and rebuild state before loading stale or missing artifacts.
- For large projects, let Graphify's generated artifact handle heavy graph rendering and keep native side panels lightweight.

## Client-Side Surface Differences

Desktop/web interface gets the full Graph Studio.

Smaller client surfaces, including mobile companion or lightweight client views, should not attempt to render the full generated canvas by default. They should show:

- Graph status and freshness.
- Project graph summary counts.
- Top nodes and communities from `/api/graphify/map`.
- A link/button to open the full Graph Studio in the desktop/web interface.
- Report summary and impact/query actions where screen size permits.

This keeps the "wow" experience where it has enough space to breathe while making graph intelligence available everywhere.

## Enhancement Roadmap

Phase one is artifact embedding plus native controls.

Phase two can add deeper polish:

- Node-to-chat handoff: "Ask Yodaman about this node."
- Impact lens: selecting a node overlays affected areas and risky dependency paths.
- Comparison view: compare graph snapshots before and after a branch or reindex.
- Annotation layer: user notes, pinned nodes, and saved investigations.
- Export options: PNG, HTML bundle, markdown report, and shareable local links.
- Live freshness indicators from the file watcher and queue service.
- Search-driven camera focus, if Graphify artifacts can expose postMessage hooks later.

## Testing Strategy

Backend:

- Unit-test artifact route validation, unknown type rejection, missing artifact responses, and project path authorization.
- Confirm CSP headers differ only for artifact routes and do not weaken the main app.

Frontend:

- Component-test empty, missing artifact, stale graph, loading, and ready states.
- Verify mode switching does not load every iframe at once.
- Verify build/rebuild flows refresh status and artifact URLs.

Manual verification:

- Build a graph for a known workspace.
- Open Graph Studio, confirm `graph.html` and `graph_visualizer.html` retain zoom/pan/filter behavior.
- Confirm the report renders readably.
- Confirm Chat/Search/Dashboard performance is unaffected until Graph Studio is opened.

## Implementation Slice

The first implementation should deliver:

1. New Graph tab and `GraphStudio.jsx`.
2. Safe artifact-serving routes for mind map, canvas visualizer, and report.
3. Sandboxed iframe viewer with mode switch.
4. Native status, rebuild, query, impact analysis, and report drawer.
5. Plugins cleanup so Graphify no longer looks like a marketplace feature.

This gives users the memorable Graph Studio moment quickly while leaving room for deeper bidirectional graph interactivity later.
