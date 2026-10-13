FROM mcr.microsoft.com/playwright:v1.58.2-noble
RUN apt-get update && apt-get install -y --no-install-recommends pulseaudio pulseaudio-utils ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
ARG SCREENSHOT_DIR
ENV SCREENSHOT_DIR=$SCREENSHOT_DIR
RUN node --check server.js && node --check provider-video-host.js && node --check audio-host.js && node --test --test-concurrency=2 && npm prune --omit=dev
ENV NODE_ENV=production
CMD ["node", "server.js"]
