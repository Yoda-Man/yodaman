# Changelog - YodaMan 🚀

All notable changes to the YodaMan project are documented here.

## [1.0.0] - 2026-05-12

### 💎 Professional UI Overhaul
-   **Brand New Identity**: Renamed project from "Context Expert GUI" to **YodaMan**.
-   **Modern Design System**: Shifted to a sleek **Slate/Indigo** palette with heavy **glassmorphism** effects.
-   **Typography**: Implemented professional fonts: **Inter** (Body), **Outfit** (Headings), and **JetBrains Mono** (Technical data).
-   **High-Tech StatusBar**: Added real-time tracking for `ctx` CLI version and active AI models.
-   **Premium Chat Interface**: Completely redesigned AI chat bubbles with "analyzing" animations and a glow-focused input field.
-   **Advanced Sidebar**: Redesigned workspace manager with better hover states and active indicators.

### 🛠️ Backend & Integration
-   **Auto-Sync Engine**: Implemented automatic discovery of repositories already indexed by the `ctx` CLI.
-   **Completed Chat API**: Added the missing `/api/ask` endpoint to bridge the frontend with the AI engine.
-   **System Status API**: New `/api/status` endpoint to dynamically fetch CLI and model metadata.
-   **File Watchers**: Improved watcher logic to handle background re-indexing reliably.

### 🧹 Cleanup & Documentation
-   **Consolidated Docs**: Merged all redundant documentation into a single, comprehensive README inside the GUI directory.
-   **Corruption Fix**: Cleaned the project of multiple corrupted RTF files and verified all source code is standard plain-text.
-   **Vite Configuration**: Fixed missing Tailwind and PostCSS configurations to ensure consistent styling across all browsers.

---
*YodaMan v1.0.0 - May the Code be with you.*
