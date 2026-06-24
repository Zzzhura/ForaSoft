# Один процесс: Node-сервер раздаёт собранный SPA (client/dist) и поднимает
# Socket.io на том же origin (TDD §12). TLS терминируется reverse-proxy'ем
# (WSS снаружи → ws внутрь), поэтому контейнер слушает HTTP без сертификата.

# --- Стадия сборки: ставим все зависимости workspace и собираем клиент ---
FROM node:20-alpine AS build
WORKDIR /app
# Сначала манифесты — кэш слоя npm ci не инвалидируется при правках исходников.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci
COPY . .
RUN npm run build

# --- Стадия рантайма: только прод-зависимости + сервер + статика ---
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
# --omit=dev: без socket.io-client/vite/vitest и прочих dev-зависимостей.
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
# Сервер ищет SPA в ../../client/dist относительно server/src (см. index.js).
COPY --from=build /app/client/dist ./client/dist

EXPOSE 3001
# Health-check бьёт в тот же /healthz, что и reverse-proxy.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT:-3001}/healthz" || exit 1

USER node
CMD ["node", "server/src/index.js"]
