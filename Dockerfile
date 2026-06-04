FROM node:20-bookworm-slim AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV YODAMAN_PORT=3090

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY backend ./backend
COPY shared ./shared
COPY public ./public
COPY plugins ./plugins
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && npm install -g @contextexpert/cli \
    && python3 -m pip install --break-system-packages graphifyy \
    && rm -rf /var/lib/apt/lists/*
COPY server.js start.js package.json config.example.json ./
RUN cp config.example.json config.json

EXPOSE 3090
CMD ["node", "server.js"]
