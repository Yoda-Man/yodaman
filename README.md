# YodaMan 🚀

**YodaMan** is a professional, full-stack intelligence platform designed for developers who demand total privacy and deep semantic understanding across their entire ecosystem. While rival tools often lose context in large repositories or limit you to a single project at a time, YodaMan provides a **local-first, high-performance engine** that unifies all your projects, documentation, and codebases into a single, coherent knowledge base. Interact with your entire digital workspace using a modern, responsive chat interface built for privacy-conscious engineers who value low-latency precision.

![YodaMan UI](https://img.shields.io/badge/UI-Premium-indigo)
![Version](https://img.shields.io/badge/Version-0.1.3-gold)
![Backend](https://img.shields.io/badge/Backend-Node.js-green)
![Frontend](https://img.shields.io/badge/Frontend-React-cyan)

## 🌟 Features

-   **Intelligent Indexing**: Automatically watches project directories and triggers re-indexing on file changes.
-   **AI Chat Interface**: Ask complex questions about your codebase with a refined, AI-focused message UI.
-   **Auto-Sync**: Automatically discovers and lists projects already indexed in your environment.
-   **Professional UI**: Premium design featuring glassmorphism, modern typography (Inter/Outfit), and sleek animations.
-   **Real-time Status**: Monitor CLI versions and active AI models directly from the high-tech status bar.
-   **Queue Management**: Smart indexing queue to prevent resource overload.
-   **Socratic Insight**: A UI that helps you realize that while you wrote the code, you're still searching for its deeper meaning.

## 🚀 One-Command Setup (Recommended)

If you are on a Mac, you can set up the entire ecosystem (Node, Python, Ollama, Engine) with a single command:

```bash
sh setup.sh
```

This script will audit your system, install missing dependencies via Homebrew, configure the project, and launch the GUI automatically.

## 📦 Global Installation (Production)

If you want to contribute or run in development mode:

### Prerequisites

-   **Node.js** (v18+)
-   **Context Expert (ctx)**: The underlying intelligence engine. Install via:
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
Dev UI available at [http://localhost:5190](http://localhost:5190).

## 🛠️ Technical Specifications

YodaMan is built with a modern, high-performance stack designed for low-latency AI interactions.

### Architecture
-   **Frontend**: React 18 + Vite + Tailwind CSS (Glassmorphic Design System).
-   **Backend**: Node.js + Express (Acting as a stateful proxy for the Intelligence Engine).
-   **AI Engine**: Utilizes local Ollama models and high-performance vector databases for ecosystem-wide context.

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
├── backend/          # Modular Backend (Clean Architecture)
│   ├── services/     # CLI, Queue, and Watcher services
│   └── routes/       # API endpoint definitions
├── src/              # React frontend source
│   ├── api/          # Centralized API client
│   ├── components/   # Premium UI components
│   └── App.jsx       # Main application logic
├── server.js         # Entry point (Bootstrap & Sync)
├── setup.sh          # One-Command System Doctor
└── manual.html       # Visual User Manual
```

## 🛠️ Configuration

-   **Ports**: Backend runs on `3090`, Frontend on `5190`.
-   **Storage**: Project settings are stored in `config.json`.
-   **Watchers**: YodaMan ignores `node_modules`, `.git`, and `dist` by default.

## 🧪 Troubleshooting

-   **Engine not found**: Ensure the Intelligence Engine is in your PATH.
-   **Styling Issues**: If the UI looks unstyled, ensure `tailwind.config.cjs` and `postcss.config.cjs` are present.
-   **Port Conflict**: Update ports in `server.js` or `vite.config.js` if 3090 or 5190 are taken.

## 📜 License

MIT
