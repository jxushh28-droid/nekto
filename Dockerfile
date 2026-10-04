FROM node:24-bookworm-slim
ENV NODE_ENV=production CHROMIUM_EXECUTABLE=/usr/bin/chromium NEKTO_DATA_DIR=/data
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY browser ./browser
COPY assets ./assets
RUN mkdir -p /data
ENTRYPOINT ["tini", "--"]
CMD ["node", "src/bot.cjs"]
