FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production PORT=3210
EXPOSE 3210
USER node
CMD ["node", "dist/src/hosted/server.js"]
