# One Dockerfile, two images:
#   target "api"  - the Bun backend (quote gateway, keeper, indexer, admin status API)
#   target "web"  - nginx serving the built frontend and proxying /api to the api service
# docker-compose.yml builds both. Public VITE_* values are baked into the web image at build time;
# secrets (ADMIN_TOKEN, KEEPER_PRIVATE_KEY, API keys) only ever reach the api container at run time.
#
# There is deliberately no "# syntax=" line: it makes BuildKit pull a frontend image from Docker Hub before
# anything else, and a slow or blocked pull looks like a build that hangs without output.

# ---------- frontend build ----------
# Built with Node, not Bun: the Vite build is lighter on Node. Bun only installs the packages, inside this stage,
# so there is no node_modules copy between stages (copying a big dependency tree was the step that stalled).
# A build host with 3 GB of RAM or more is recommended; 2 GB needs swap.
FROM node:22-slim AS build
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=1792
RUN npm install -g bun@1.3.14 --no-audit --no-fund
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
ARG VITE_DEFAULT_NETWORK=arc-testnet
ARG VITE_RPC_URL_ARC_TESTNET=
ARG VITE_RPC_URL_ARC=
ARG VITE_ORDERS_ADDRESS_ARC_TESTNET=
ARG VITE_ORDERS_DEPLOY_TX_ARC_TESTNET=
ARG VITE_ORDERS_ADDRESS_ARC_MAINNET=
ARG VITE_ORDERS_DEPLOY_TX_ARC_MAINNET=
ARG VITE_SWAP_TARGETS_ARC=
ARG VITE_SOCIAL_X=
ARG VITE_SOCIAL_DISCORD=
ARG VITE_SOCIAL_TELEGRAM=
ARG VITE_SOCIAL_GITHUB=
ARG VITE_DOCS_URL=
ARG VITE_SUPPORT_URL=
ARG VITE_TERMS_URL=
ARG VITE_PRIVACY_URL=
# The Circle Client Key is a public browser key (it ships in the JS bundle, restricted by Passkey Domain). Docker's
# "secrets in ARG" lint fires on the name only. Real secrets (ADMIN_TOKEN, KEEPER_PRIVATE_KEY, *_API_KEY) are never build args.
ARG VITE_CIRCLE_CLIENT_KEY=
ARG VITE_CIRCLE_CLIENT_URL=
ARG VITE_CIRCLE_SPONSOR_GAS=
ENV VITE_DEFAULT_NETWORK=$VITE_DEFAULT_NETWORK \
    VITE_RPC_URL_ARC_TESTNET=$VITE_RPC_URL_ARC_TESTNET \
    VITE_RPC_URL_ARC=$VITE_RPC_URL_ARC \
    VITE_ORDERS_ADDRESS_ARC_TESTNET=$VITE_ORDERS_ADDRESS_ARC_TESTNET \
    VITE_ORDERS_DEPLOY_TX_ARC_TESTNET=$VITE_ORDERS_DEPLOY_TX_ARC_TESTNET \
    VITE_ORDERS_ADDRESS_ARC_MAINNET=$VITE_ORDERS_ADDRESS_ARC_MAINNET \
    VITE_ORDERS_DEPLOY_TX_ARC_MAINNET=$VITE_ORDERS_DEPLOY_TX_ARC_MAINNET \
    VITE_SWAP_TARGETS_ARC=$VITE_SWAP_TARGETS_ARC \
    VITE_SOCIAL_X=$VITE_SOCIAL_X \
    VITE_SOCIAL_DISCORD=$VITE_SOCIAL_DISCORD \
    VITE_SOCIAL_TELEGRAM=$VITE_SOCIAL_TELEGRAM \
    VITE_SOCIAL_GITHUB=$VITE_SOCIAL_GITHUB \
    VITE_DOCS_URL=$VITE_DOCS_URL \
    VITE_SUPPORT_URL=$VITE_SUPPORT_URL \
    VITE_TERMS_URL=$VITE_TERMS_URL \
    VITE_PRIVACY_URL=$VITE_PRIVACY_URL \
    VITE_CIRCLE_CLIENT_KEY=$VITE_CIRCLE_CLIENT_KEY \
    VITE_CIRCLE_CLIENT_URL=$VITE_CIRCLE_CLIENT_URL \
    VITE_CIRCLE_SPONSOR_GAS=$VITE_CIRCLE_SPONSOR_GAS
# Only what the build reads, so editing nginx or server files does not rerun the (slow, memory-hungry) build.
COPY index.html vite.config.ts tailwind.config.js postcss.config.js tsconfig.json ./
COPY src ./src
COPY public ./public
RUN node node_modules/vite/bin/vite.js build

# ---------- web (nginx) ----------
FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

# ---------- api (Bun) ----------
FROM oven/bun:1 AS api
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json tsconfig.server.json ./
COPY server ./server
COPY src ./src
COPY public ./public
# The indexer database lives here. Mount a volume on it or history is rebuilt from chain on every deploy.
RUN mkdir -p /app/data && chown -R bun:bun /app/data
USER bun
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server/index.ts"]
