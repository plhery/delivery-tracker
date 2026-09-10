FROM ghcr.io/germondai/trawl:1.5.0@sha256:9cf6668dc5e7160d739991ca1edfe308c48638696571d9413a18399696586698
COPY tracking-capture.mjs /app/packages/tiers/src/utils/tracking-capture.mjs
COPY install.mjs /tmp/install-tracking-capture.mjs
RUN bun /tmp/install-tracking-capture.mjs && rm /tmp/install-tracking-capture.mjs
