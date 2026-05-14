# YodaMan Architecture Overview

This document describes the high-level architecture of YodaMan, a premium intelligence platform for developers.

## System Architecture

YodaMan follows a **Clean Architecture** pattern to ensure separation of concerns, testability, and maintainability.

```mermaid
graph TD
    subgraph Frontend
        React[React UI]
        Vite[Vite Build Tool]
    end

    subgraph Backend_Interface_Layer
        API[RestController]
    end

    subgraph Backend_Core_Layer
        Agent[AgentReasoningEngine]
        Queue[QueueService]
    end

    subgraph Backend_Infrastructure_Layer
        Engine[ContextEngine]
        Watcher[FileSystemWatcher]
        Tools[ToolBox]
    end

    subgraph External
        Ctx[Context Expert CLI]
        FS[Local File System]
    end

    React -->|HTTP/SSE| API
    API --> Agent
    API --> Queue
    Agent --> Tools
    Agent --> Engine
    Queue --> Engine
    Watcher --> Queue
    Engine --> Ctx
    Tools --> FS
    Tools --> Engine
```

## Layer Responsibilities

### 1. Interface Layer (`backend/interfaces`)
- **RestController**: Handles HTTP requests and Server-Sent Events (SSE). It serves as the entry point for the frontend to interact with the system.

### 2. Core/Domain Layer (`backend/core`)
- **AgentReasoningEngine**: The "brain" of the application. It manages the multi-step reasoning loop (ReAct pattern), orchestrating tool usage to solve user tasks.
- **QueueService**: Manages asynchronous indexing tasks to ensure that heavy CLI operations do not block the UI or overwhelm system resources.

### 3. Infrastructure Layer (`backend/infrastructure`)
- **ContextEngine**: A robust wrapper around the `ctx` CLI. Handles binary execution, output buffering, and complex JSON extraction.
- **FileSystemWatcher**: Uses Chokidar to monitor project directories for changes, triggering automatic re-indexing via the QueueService.
- **ToolBox**: Provides concrete implementations for the Agent's tools, such as reading/writing files and executing shell commands.

## Key Workflows

### Agentic Task Execution (Sequence)

```mermaid
sequenceDiagram
    participant User
    participant UI as React UI
    participant RC as RestController
    participant ARE as AgentReasoningEngine
    participant TB as ToolBox
    participant CE as ContextEngine

    User->>UI: Enter "Refactor App.jsx"
    UI->>RC: POST /api/agent/task
    RC->>ARE: executeTask(task)
    loop Reasoning Loop
        ARE->>CE: execute(['ask', conversation])
        CE-->>ARE: Tool Call: "readFile"
        ARE->>TB: readFile('App.jsx')
        TB-->>ARE: File Content
        ARE->>RC: SSE: { type: 'tool_start', tool: 'readFile' }
    end
    ARE-->>RC: Final Answer
    RC-->>UI: SSE: { type: 'final_answer' }
    UI->>User: Display Result
```
