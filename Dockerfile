# Node major matches "engines" in package.json (tests/architecture/DockerfileMatchesRuntime.test.js).
FROM node:24-bookworm-slim AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV YODAMAN_PORT=3090

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY backend ./backend
COPY shared ./shared
COPY public ./public
COPY plugins ./plugins
# ctx and OpenSpec install with the commands DependencyChecker.js gives `yodaman setup`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && npm install -g yodaman-ctx --allow-scripts=better-sqlite3,protobufjs,sharp,tree-sitter,tree-sitter-javascript,tree-sitter-python,tree-sitter-typescript,tree-sitter-go,tree-sitter-rust,tree-sitter-java,tree-sitter-c-sharp,tree-sitter-c,tree-sitter-cpp,tree-sitter-php,tree-sitter-ruby,tree-sitter-powershell,onnxruntime-node \
    && npm install -g @fission-ai/openspec@latest \
    && python3 -m pip install --break-system-packages graphifyy \
    && rm -rf /var/lib/apt/lists/*
COPY server.js start.js package.json config.example.json ./
RUN cp config.example.json config.json

EXPOSE 3090
CMD ["node", "server.js"]
