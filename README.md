# YodaMan 🚀

**YodaMan** is a premium, full-stack intelligence platform designed for developers who demand total privacy and deep semantic understanding across their entire ecosystem.

![Version](https://img.shields.io/badge/Version-0.1.4-gold)
![Architecture](https://img.shields.io/badge/Architecture-Clean-indigo)
![License](https://img.shields.io/badge/License-MIT-green)

## 🌟 Key Features

-   **Autonomous Agent Mode**: Let Yoda-Agent refactor, search, and manage your codebase with multi-step reasoning.
-   **Intelligent Indexing**: Automatically watches project directories and triggers re-indexing on file changes.
-   **Local-First Privacy**: Designed to work with local LLMs (via Ollama) to keep your intellectual property on your machine.
-   **Premium UI**: High-tech dashboard featuring glassmorphism and real-time system telemetry.

## 🚀 Quick Start

### 1. Prerequisites
- Node.js (v18+)
- [Context Expert CLI](https://github.com/Yoda-Man/context-expert) (`npm install -g @contextexpert/cli`)

### 2. Setup
```bash
git clone https://github.com/Yoda-Man/yodaman.git
cd yodaman
npm install
sh setup.sh
```

### 3. Launch
```bash
npm start
```
Visit `http://localhost:5190` to start exploring.

## 📚 Documentation

Detailed documentation is available in the `docs/` folder:

-   [**Architecture Overview**](docs/architecture.md): Deep dive into the Clean Architecture and component interaction.
-   [**API Reference**](docs/api.md): Full documentation for REST and SSE endpoints.
-   [**Setup & Installation**](docs/setup.md): Detailed environment configuration.
-   [**User Manual**](user_manual.html): Visual guide for primary workflows.

## 🏗️ Clean Architecture

YodaMan is built with a layered architecture to ensure scalability:
- **Presentation**: React + Vite (Glassmorphic Design)
- **Interface**: Express Controllers (REST/SSE)
- **Core**: Business Logic (Agent Engine, Queue Management)
- **Infrastructure**: System Integrations (CLI Wrapper, File Watcher)

## 📜 License

This project is licensed under the MIT License.
