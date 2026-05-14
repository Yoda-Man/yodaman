# Setup & Installation Guide

## Prerequisites

- **Node.js**: v18.0.0 or higher.
- **Context Expert (ctx)**: The intelligence engine must be installed globally.
  ```bash
  npm install -g @contextexpert/cli
  ```
- **Ollama**: (Optional but recommended) For local AI model execution.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Yoda-Man/yodaman.git
   cd yodaman
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Initialize the ecosystem (Mac only):
   ```bash
   sh setup.sh
   ```

## Configuration

YodaMan stores its configuration in `config.json` at the root of the project.

```json
{
  "watchedDirectories": [
    "/Users/username/projects/my-app"
  ]
}
```

- **watchedDirectories**: A list of absolute paths that YodaMan will monitor for changes.
