FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM base AS runtime
COPY server ./server
COPY coop-objects.js coop-campaigns.js ./
EXPOSE 8080
CMD ["node", "server/server.js"]

FROM base AS test
COPY server ./server
COPY tests ./tests
COPY coop-bubbles.js coop-objects.js coop-campaigns.js support.js index.html nginx.conf ./
CMD ["npm", "test"]
