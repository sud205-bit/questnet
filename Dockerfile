# ─────────────────────────────────────────────────────────────
# Stage 1: Builder — install deps + compile TypeScript + build Vite
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json package-lock.json ./

# Install ALL deps (including devDeps needed for build)
RUN npm ci

# Copy source
COPY . .

# Build: Vite frontend → dist/public  +  esbuild backend → dist/index.cjs
RUN npm run build

# ─────────────────────────────────────────────────────────────
# Stage 2: Production — lean image, no devDeps, no source
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Copy manifests and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Railway injects $PORT at runtime. We pin it to 3000 so the app and
# Railway's routing layer always agree on the same port.
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Healthcheck — Railway polls /health before routing traffic
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.cjs"]
