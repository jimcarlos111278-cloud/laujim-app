FROM node:22-bookworm-slim

ENV NODE_ENV=production \
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

RUN mkdir -p /tmp/laujim-chrome-profiles \
  && chown -R node:node /app /tmp/laujim-chrome-profiles
USER node

EXPOSE 10000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["xvfb-run", "--server-num=99", "--server-args=-screen 0 1366x768x24 -ac", "npm", "start"]
