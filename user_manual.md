# YodaMan User Manual 🧠

Welcome to **YodaMan**, the professional intelligence platform for your entire development ecosystem. This manual will guide you through the setup, features, and best practices for mastering your codebases with 100% local privacy.

---

## 1. Introduction
YodaMan is a professional, full-stack intelligence platform powered by high-performance deep semantic indexing. Unlike rival tools that are limited to single-project analysis or cloud-based data leaks, YodaMan provides a **local-first, high-performance engine** that unifies all your projects, documentation, and codebases into a single, coherent knowledge base.

## 2. Quick Setup
The fastest way to get started is using the **One-Command Setup**:

1.  Open your terminal in the project root.
2.  Run: `sh setup.sh`
3.  The script will automatically audit your system and install Node.js, Python, Ollama, and the **Context Expert (ctx)** intelligence engine.

## 3. Core Concepts

### 📂 Ecosystem Intelligence
YodaMan doesn't just look at one folder. It understands your entire digital workspace. Once indexed, the AI "remembers" the structure, logic, and patterns across all your disparate projects and documentation.

### 🔍 Deep Semantic Search
Powered by vector mapping, YodaMan understands the *meaning* of your code. Searching for "authentication" will find login logic, JWT handlers, and security middleware even if the word "authentication" isn't explicitly used.

### 💬 Unified Context Chat
The Chat window allows you to ask complex questions across your entire ecosystem. YodaMan retrieves the relevant context from multiple projects to generate accurate, low-latency answers.

---

## 4. Using the Interface

### The Sidebar (Workspace Manager)
-   **Register Repository**: Click the `+` button to add a new folder.
-   **Auto-Sync**: YodaMan automatically detects projects you index via the CLI—no restart required.
-   **Sync Repository**: Click the "Sync Repository" button to re-scan your code after making changes.
-   **Health Check**: Monitor the "Valid" or "Error" status for each workspace in real-time.

### The Search Tab
-   Enter any query to see matching code blocks across all your repositories.
-   Use the **Project Filter** to limit results to a specific repository when needed.
-   View high-precision relevance scores (e.g., 98.5%) for every match.

### The High-Tech Status Bar
-   **Node Status**: Confirms the backend server is active.
-   **Engine Version**: Displays the current intelligence engine version.
-   **Active Model**: Shows which local AI model (e.g., Llama 3 or Qwen) is powering your insights.

---

## 5. Pro Tips 💡
-   **Keep Ollama Running**: YodaMan relies on local models for privacy. Ensure Ollama is active on your machine.
-   **Unified Documentation**: Index your project's `.md` and `.txt` files alongside your code for the ultimate "Context Expert" experience.
-   **Natural Language Precision**: Ask full questions like *"How does the auth flow differ between my API and the frontend service?"* to leverage multi-project context.

## 6. Troubleshooting
-   **Engine not found**: Ensure the Intelligence Engine is in your PATH or run `sh setup.sh`.
-   **Port Conflict**: YodaMan runs on ports **5190** (Frontend) and **3090** (Backend). Ensure these are available.
-   **Re-indexing**: If results seem outdated, click the "Sync Repository" button to refresh the index.

---
*YodaMan v0.1.5 - Total Privacy. Ecosystem Intelligence.*
