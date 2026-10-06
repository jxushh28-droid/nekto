FROM mcr.microsoft.com/playwright:v1.58.2-noble
RUN apt-get update && apt-get install -y --no-install-recommends pulseaudio pulseaudio-utils ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN node --check server.js && node --check video-host.js && node --test tests/video-host.test.js tests/video-session-config.test.js tests/video-frame-browser.test.js tests/audio-host.test.js tests/audio-runtime.test.js tests/audio-devices.test.js tests/server-open.test.js tests/dashboard-browser.test.js
ENV NODE_ENV=production
CMD ["node", "server.js"]
