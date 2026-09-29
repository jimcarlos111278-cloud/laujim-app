FROM node:22-bookworm-slim

# Fuente de verdad de este archivo: deploy-oracle-vm/Dockerfile.app en el repo.
# Copiar ahí cualquier cambio y redesplegar a /home/ubuntu/laujim-app/app/Dockerfile.

ENV NODE_ENV=production \
    PORT=10000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    LAUJIM_FULL_CHROME=true \
    LAUJIM_CHROME_PROFILE_DIR=/tmp/laujim-chrome-profiles \
    DISPLAY=:99

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    curl \
    fonts-liberation \
    fonts-noto-color-emoji \
    tini \
    xauth \
    xvfb \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Agente de código por WhatsApp: el puente (opencode-bridge.cjs) lo invoca
# vía spawn como usuario node. Se copia (no symlink) porque /root es 700
# y node no puede atravesarlo (spawn EACCES).
RUN curl -fsSL https://opencode.ai/install | bash \
  && cp /root/.opencode/bin/opencode /usr/local/bin/opencode \
  && chmod 755 /usr/local/bin/opencode \
  && rm -rf /root/.opencode \
  && /usr/local/bin/opencode --version

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

RUN chmod 755 /app/docker-start.sh \
  && mkdir -p /tmp/laujim-chrome-profiles \
  && chown -R node:node /app /tmp/laujim-chrome-profiles
USER node

EXPOSE 10000

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 10000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-start.sh"]
