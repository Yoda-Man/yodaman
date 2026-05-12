#!/bin/bash

# YodaMan System Doctor & Installer 🚀
# Version 1.0.0

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
    echo -e "${GREEN}OK ($(node -v))${NC}"
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
if check_cmd ctx; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}Missing${NC}"
    echo -e "📦 Installing @contextexpert/cli globally..."
    npm install -g @contextexpert/cli
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
