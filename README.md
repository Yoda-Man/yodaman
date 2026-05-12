# YodaMan 🚀

**YodaMan** is a professional, full-stack web interface for the `context-expert` (ctx) CLI. It allows you to easily index your codebases and interact with them using a modern, responsive chat interface with a premium UI.

![YodaMan UI](https://img.shields.io/badge/UI-Premium-indigo)
![Version](https://img.shields.io/badge/Version-0.1.0-gold)
![Backend](https://img.shields.io/badge/Backend-Node.js-green)
![Frontend](https://img.shields.io/badge/Frontend-React-cyan)

## 🌟 Features

-   **Intelligent Indexing**: Automatically watches project directories and triggers re-indexing via `ctx` on file changes.
-   **AI Chat Interface**: Ask complex questions about your codebase with a refined, AI-focused message UI.
-   **Auto-Sync**: Automatically discovers and lists projects already indexed by the `ctx` CLI.
-   **Professional UI**: Premium design featuring glassmorphism, modern typography (Inter/Outfit), and sleek animations.
-   **Real-time Status**: Monitor CLI versions and active AI models directly from the high-tech status bar.
-   **Queue Management**: Smart indexing queue to prevent resource overload.
-   **Socratic Insight**: A UI that helps you realize that while you wrote the code, you're still searching for its deeper meaning.

## 🚀 One-Command Setup (Recommended)

If you are on a Mac, you can set up everything (Node, Python, Ollama, ctx) with a single command from inside the `yodaman` folder:

```bash
sh setup.sh
```

This script will audit your system, install missing dependencies via Homebrew, configure the project, and launch the GUI automatically.

## 📦 Global Installation (Production)

If you want to contribute or run in development mode:

### Prerequisites

-   **Node.js** (v18+)
-   **Context Expert (ctx)** CLI installed globally:
    ```bash
    npm install -g @contextexpert/cli
    ```

### Installation

1.  Navigate to the YodaMan directory:
    ```bash
    cd yodaman
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

### Running in Dev Mode

Start both the backend and frontend with HMR:
```bash
npm start
```
Dev UI available at [http://localhost:5173](http://localhost:5173).

## 🛠️ Technical Specifications

YodaMan is built with a modern, high-performance stack designed for low-latency AI interactions.

### Architecture
-   **Frontend**: React 18 + Vite + Tailwind CSS (Glassmorphic Design System).
-   **Backend**: Node.js + Express (Acting as a stateful proxy for the `ctx` CLI).
-   **AI Engine**: Integrates with `ctx` CLI which utilizes local Ollama models and Vector databases.

### API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/projects` | GET | Returns a list of all indexed workspaces. |
| `/api/ask` | POST | Proxies a natural language query to the AI engine. |
| `/api/search` | GET | Performs semantic code search across indices. |
| `/api/status` | GET | Returns real-time system telemetry and model info. |
| `/api/check` | GET | Runs a health check on a specific workspace path. |
| `/api/config` | GET/POST| Manages global CLI configuration settings. |

## 🏗️ Project Structure

```text
yodaman/
├── bin/              # CLI executable wrapper
├── public/           # Static assets (Logo, Manual)
├── src/              # React frontend source
│   ├── components/   # Premium UI components
│   └── App.jsx       # Main application logic
├── server.js         # Express backend & CLI Proxy
├── setup.sh          # One-Command System Doctor
└── manual.html       # Visual User Manual
```

## 🛠️ Configuration

-   **Ports**: Backend runs on `3001`, Frontend on `5173`.
-   **Storage**: Project settings are stored in `config.json`.
-   **Watchers**: YodaMan ignores `node_modules`, `.git`, and `dist` by default.

## 🧪 Troubleshooting

-   **ctx not found**: Ensure `ctx` is in your PATH. Run `ctx --version` to verify.
-   **Styling Issues**: If the UI looks unstyled, ensure `tailwind.config.cjs` and `postcss.config.cjs` are present.
-   **Port Conflict**: Update ports in `server.js` or `vite.config.js` if 3001 or 5173 are taken.

## 📜 License

MIT
