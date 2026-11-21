#!/bin/bash

# YodaMan System Doctor & Installer 🚀

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}          YODAMAN SYSTEM DOCTOR & SETUP         ${NC}"
echo -e "${BLUE}================================================${NC}"
echo -e "This script will check and install all dependencies for YodaMan."

# Function to check command exists
check_cmd() {
    command -v "$1" >/dev/null 2>&1
}

check_graphify() {
    check_cmd graphify && return 0
    ls "$HOME"/Library/Python/*/bin/graphify >/dev/null 2>&1
}

# Minimums: package.json "engines" and DependencyChecker's SERVICES.ctx.minVersion.
NODE_MIN_MAJOR=24
CTX_MIN_VERSION=1.3.4

# True when dotted version $1 is at least $2 (a leading "v" and any suffix are ignored).
version_at_least() {
    awk -v have="$1" -v need="$2" 'BEGIN {
        sub(/^v/, "", have); match(have, /^[0-9.]*/); have = substr(have, 1, RLENGTH)
        split(have, h, "."); split(need, n, ".")
        for (i = 1; i <= 3; i++) { if (h[i] + 0 > n[i] + 0) exit 0; if (h[i] + 0 < n[i] + 0) exit 1 }
        exit 0
    }'
}

node_version_ok() {
    version_at_least "$(node -v 2>/dev/null)" "$NODE_MIN_MAJOR"
}

# A ctx that fails to report a version counts as too old, as in DependencyChecker.
ctx_version_ok() {
    version_at_least "$(ctx --version 2>/dev/null | head -n 1)" "$CTX_MIN_VERSION"
}

# 1. Check for Homebrew (MacOS Package Manager)
echo -ne "🔍 Checking Homebrew... "
if check_cmd brew; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}Missing${NC}"
    echo -e "📦 Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# 2. Check for Node.js
echo -ne "🔍 Checking Node.js... "
if check_cmd node; then
    if node_version_ok; then
        echo -e "${GREEN}OK ($(node -v))${NC}"
    else
        echo -e "${RED}Too old ($(node -v))${NC}"
        echo -e "YodaMan needs Node.js ${NODE_MIN_MAJOR} or newer. Upgrade it (brew upgrade node, or nvm install ${NODE_MIN_MAJOR}) and run setup.sh again."
        exit 1
    fi
else
    echo -e "${YELLOW}Missing${NC}"
    echo -e "📦 Installing Node.js..."
    brew install node
fi

# 3. Check for Python 3
echo -ne "🔍 Checking Python 3... "
if check_cmd python3; then
    echo -e "${GREEN}OK ($(python3 --version))${NC}"
else
    echo -e "${YELLOW}Missing${NC}"
    echo -e "📦 Installing Python..."
    brew install python
fi

# 4. Check for Ollama (AI Model Server)
echo -ne "🔍 Checking Ollama... "
if check_cmd ollama; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}Missing${NC}"
    echo -e "📦 Installing Ollama..."
    brew install ollama
    echo -e "${BLUE}💡 Tip: Make sure to launch the Ollama app to start the model server.${NC}"
fi

# 5. Check for Context Expert (ctx)
echo -ne "🔍 Checking Context Expert (ctx)... "
if check_cmd ctx && ctx_version_ok; then
    echo -e "${GREEN}OK ($(ctx --version | head -n 1))${NC}"
else
    if check_cmd ctx; then
        echo -e "${YELLOW}Too old ($(ctx --version 2>/dev/null | head -n 1)); YodaMan needs ${CTX_MIN_VERSION} or newer${NC}"
    else
        echo -e "${YELLOW}Missing${NC}"
    fi
    echo -e "📦 Installing yodaman-ctx (YodaMan's Context Expert) globally..."
    npm install -g yodaman-ctx --allow-scripts=better-sqlite3,protobufjs,sharp,tree-sitter,tree-sitter-javascript,tree-sitter-python,tree-sitter-typescript,tree-sitter-go,tree-sitter-rust,tree-sitter-java,tree-sitter-c-sharp,tree-sitter-c,tree-sitter-cpp,tree-sitter-php,tree-sitter-ruby,tree-sitter-powershell,onnxruntime-node
fi

# 6. Check for Graphify
echo -ne "🔍 Checking Graphify... "
if check_graphify; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}Missing${NC}"
    echo -e "📦 Installing graphifyy..."
    python3 -m pip install --user graphifyy || python3 -m pip install --user --break-system-packages graphifyy
fi

# 7. Check for OpenSpec (required by the Stardust spec-driven workflow)
echo -ne "🔍 Checking OpenSpec... "
if check_cmd openspec; then
    echo -e "${GREEN}OK ($(openspec --version 2>/dev/null || echo installed))${NC}"
else
    echo -e "${YELLOW}Missing${NC}"
    echo -e "📦 Installing @fission-ai/openspec globally..."
    npm install -g @fission-ai/openspec@latest
fi

echo -e "${BLUE}------------------------------------------------${NC}"
echo -e "🔍 Finalizing YodaMan Installation..."

# Navigate to GUI folder and install local dependencies
echo -e "📦 Installing GUI dependencies..."
npm install

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}        ✅ SETUP COMPLETE! YodaMan is ready.     ${NC}"
echo -e "${GREEN}================================================${NC}"
echo -e "Starting YodaMan now..."
npm start
