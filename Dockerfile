# ─────────────────────────────────────────────────────────────
# Stage 1: Builder — install ALL deps (incl. native modules) + build
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Build tools required by better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json package-lock.json ./

# Install ALL deps (devDeps needed for build + native modules compiled here)
RUN npm ci

# Copy source
COPY . .

# Build: Vite frontend → dist/public  +  esbuild backend → dist/index.cjs
RUN npm run build

# ─────────────────────────────────────────────────────────────
# Stage 2: Production — copy compiled output + pre-built node_modules
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy pre-built node_modules from builder (already compiled for musl/Alpine)
# This avoids re-running npm ci in production where build tools are absent.
COPY --from=builder /app/node_modules ./node_modules

# Copy package.json (needed by Node module resolution)
COPY package.json ./

ENV NODE_ENV=production
# Railway injects its own $PORT at runtime; we default to 3000
ENV PORT=3000

EXPOSE 3000

# Healthcheck — Railway polls /health before routing traffic
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.cjs"]
