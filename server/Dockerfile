FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM base AS runtime
COPY server ./server
EXPOSE 8080
CMD ["node", "server/server.js"]

FROM base AS test
COPY server ./server
COPY tests ./tests
COPY coop-bubbles.js support.js index.html nginx.conf ./
CMD ["npm", "test"]
