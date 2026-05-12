# YodaMan User Manual 🧠

Welcome to **YodaMan**, the professional command center for your code intelligence. This manual will guide you through the setup, features, and best practices for using YodaMan to master your codebase.

---

## 1. Introduction
YodaMan is a full-stack GUI for the `context-expert` (ctx) engine. It combines advanced RAG (Retrieval-Augmented Generation) with a premium user interface to provide semantic search, context-aware Q&A, and system telemetry for developers.

## 2. Quick Setup
The fastest way to get started is using the **One-Command Setup**:

1.  Open your terminal in the project root.
2.  Run: `sh setup.sh`
3.  The script will automatically install Node.js, Python, Ollama, and the `ctx` CLI.

## 3. Core Concepts

### 📂 Workspaces
A Workspace is a directory on your machine that has been indexed by YodaMan. Once indexed, the AI "remembers" the structure, logic, and patterns within that code.

### 🔍 Semantic Search
Unlike traditional text search, Semantic Search understands the *meaning* of your code. Searching for "authentication" will find login logic even if the word "authentication" isn't in the file.

### 💬 Context-Aware Chat
The Chat window allows you to ask complex questions like *"How is the payment flow implemented?"* or *"Where are the API endpoints defined?"*. YodaMan retrieves the relevant code snippets and uses them to generate accurate answers.

---

## 4. Using the Interface

### The Sidebar (Workspace Manager)
-   **Register Repository**: Click the `+` button to add a new folder to YodaMan.
-   **Sync Index**: Click the refresh icon to re-scan your code after making changes.
-   **Validate**: Click the shield icon to run a health check on your index.

### The Search Tab
-   Enter any query to see matching code blocks across all your projects.
-   Use the **Project Filter** to limit results to a specific repository.
-   View relevance scores to see how closely the code matches your intent.

### The Dashboard
-   Monitor your **Vector Storage** (database size).
-   Check which **AI Model** is currently active (e.g., Qwen 3.5).
-   View total **Chunks** (the small pieces of code YodaMan has "learned").

---

## 5. Tips for Newbies 💡
-   **Keep Ollama Running**: YodaMan relies on Ollama for its AI brain. Ensure the Ollama app is active on your machine.
-   **Index Large Projects Separately**: While YodaMan is fast, indexing massive repositories (like a monorepo) might take a few minutes.
-   **Use Natural Language**: Don't just type keywords. Ask full questions like *"Explain the error handling in this project."*

## 6. Troubleshooting
-   **UI is blank**: Hard refresh your browser (`Cmd+Shift+R`).
-   **Chat is slow**: Check your system resources; large local models require significant RAM/GPU.
-   **ctx command not found**: Run `sh setup.sh` to fix your path.

---
*YodaMan v0.1.0 - The force is with your code.*
