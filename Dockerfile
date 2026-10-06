FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN node --check server.js && node --check video-host.js && node --test tests/video-host.test.js tests/video-session-config.test.js
ENV NODE_ENV=production
CMD ["node", "server.js"]
