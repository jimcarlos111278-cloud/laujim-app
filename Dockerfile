FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=10000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    RENDER_FULL_CHROME=true \
    RENDER_CHROME_PROFILE_DIR=/tmp/laujim-chrome-profiles \
    DISPLAY=:99

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    tini \
    xauth \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

RUN chmod 755 /app/docker-start-render.sh \
  && mkdir -p /tmp/laujim-chrome-profiles \
  && chown -R node:node /app /tmp/laujim-chrome-profiles
USER node

EXPOSE 10000

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 10000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-start-render.sh"]
