# crossly-mock: Stoplight Prism serving the Crossly seller (:4010) and buyer (:4011) APIs with realistic examples.
#
# The specs in specs/ are prepared on the CI runner (scripts/prepare-specs.mjs) from a crossly-openapi release whose
# provenance was verified first, so this build only installs Prism and copies files.
# Prism 5.16 requires Node >= 24.18.
FROM node:26-alpine

ARG PRISM_VERSION=5.16.0
RUN npm install -g "@stoplight/prism-cli@${PRISM_VERSION}" --no-audit --no-fund \
 && npm cache clean --force \
 && prism --version

WORKDIR /mock
COPY scripts/serve.mjs scripts/healthcheck.mjs scripts/
COPY specs/ specs/

ENV SELLER_PORT=4010 \
    BUYER_PORT=4011 \
    NODE_ENV=production
USER node
EXPOSE 4010 4011
# Prism needs a while to load the 11 MB seller spec on a slow (emulated) CPU.
HEALTHCHECK --interval=10s --timeout=5s --start-period=240s --retries=3 CMD ["node", "/mock/scripts/healthcheck.mjs"]
ENTRYPOINT ["node", "/mock/scripts/serve.mjs"]
