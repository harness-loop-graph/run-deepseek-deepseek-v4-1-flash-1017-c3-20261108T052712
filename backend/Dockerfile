# Backend image: NestJS REST API (EP-01 .. EP-20).
#
# The image compiles the TypeScript sources and starts `dist/main.js`. The data
# layer is applied by `DatabaseModule.onModuleInit` before the HTTP listener
# opens, so starting the container runs the versioned migrations and the
# deterministic seed (RF-02, RF-05, RF-27) on every boot, idempotently.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# RF-17: attachments live on a volume outside any served directory; the process
# runs unprivileged and only owns that storage path.
RUN mkdir -p /app/storage/attachments && chown -R node:node /app/storage
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
