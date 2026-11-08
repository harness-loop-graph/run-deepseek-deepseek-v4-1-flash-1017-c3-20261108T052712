# Frontend image: static build of the React SPA served by nginx (RF-19, RF-27).
#
# Stage 1 compiles the bundle with the same Vite configuration used locally;
# the `VITE_*` values arrive as build args from `docker-compose.yml` (see
# `.env.example`) and are baked into the bundle at build time, because a
# static SPA has no server-side configuration of its own (RF-18, RF-26).
#
# Stage 2 serves `dist/` on port 80, which the `frontend` service maps to host
# port 8080. `nginx.conf` falls back to `index.html` so every client-side route
# — including the registered redirect URI `/auth/callback` — survives a reload.

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# Configuration is public build-time data, never a secret.
ARG VITE_API_BASE_URL=http://localhost:3000
ARG VITE_OAUTH_CLIENT_ID=medapp-spa
ARG VITE_OAUTH_REDIRECT_URI=http://localhost:8080/auth/callback
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_OAUTH_CLIENT_ID=${VITE_OAUTH_CLIENT_ID} \
    VITE_OAUTH_REDIRECT_URI=${VITE_OAUTH_REDIRECT_URI}

RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --retries=6 --start-period=5s \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
