FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_USE_API=true
ARG NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=false
ARG NEXT_PUBLIC_AUTH_APPLE_ENABLED=false
ARG NEXT_PUBLIC_AUTH_EMAIL_OTP_ENABLED=true
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_USE_API=$NEXT_PUBLIC_USE_API \
    NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=$NEXT_PUBLIC_AUTH_GOOGLE_ENABLED \
    NEXT_PUBLIC_AUTH_APPLE_ENABLED=$NEXT_PUBLIC_AUTH_APPLE_ENABLED \
    NEXT_PUBLIC_AUTH_EMAIL_OTP_ENABLED=$NEXT_PUBLIC_AUTH_EMAIL_OTP_ENABLED
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run validate:production-config \
    && npm run build

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--enable-source-maps \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    TRACKING_CHROMIUM_PATH=/usr/bin/chromium
# Coolify probes Dockerfile applications with curl from inside the container.
RUN apk add --no-cache curl chromium \
    && addgroup --system --gid 10001 delivery \
    && adduser --system --uid 10001 --ingroup delivery delivery
COPY --from=build --chown=delivery:delivery /app/.next/standalone ./
USER delivery
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["curl", "--fail", "--silent", "--show-error", "--max-time", "5", "http://127.0.0.1:3000/health"]
CMD ["node", "server.js"]
