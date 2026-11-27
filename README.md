# crossly-mock

[![release](https://github.com/crossly-dev/crossly-mock/actions/workflows/release.yml/badge.svg)](https://github.com/crossly-dev/crossly-mock/actions/workflows/release.yml) [![ci](https://github.com/crossly-dev/crossly-mock/actions/workflows/ci.yml/badge.svg)](https://github.com/crossly-dev/crossly-mock/actions/workflows/ci.yml) [![image](https://img.shields.io/badge/ghcr.io-crossly--dev%2Fcrossly--mock-2496ed?logo=docker&logoColor=white)](https://github.com/crossly-dev/crossly-mock/pkgs/container/crossly-mock) [![spec](https://img.shields.io/github/v/release/crossly-dev/crossly-openapi?label=crossly-openapi)](https://github.com/crossly-dev/crossly-openapi/releases/latest) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A mock [Crossly](https://crossly.net) API for testing an integration without a real store, a real token or real
marketplace side effects. It serves the published [OpenAPI specs](https://github.com/crossly-dev/crossly-openapi)
with [Stoplight Prism](https://github.com/stoplightio/prism): every operation answers, requests are validated, and
responses are realistic, deterministic examples that match the schema.

## Quickstart

```sh
docker run --rm -p 4010:4010 -p 4011:4011 ghcr.io/crossly-dev/crossly-mock

curl -H 'Authorization: Bearer crossly_pat_test' http://localhost:4010/v1/me
curl -H 'Authorization: Bearer crossly_pat_test' 'http://localhost:4010/v1/inventory?limit=5'
curl -H 'Authorization: Bearer crossly_oat_test' http://localhost:4011/v1/buyer/profile
```

Only the seller API? `docker run --rm -p 4010:4010 ghcr.io/crossly-dev/crossly-mock` is enough (the buyer API still
runs inside on 4011, unpublished).

| port | API | spec |
|---|---|---|
| `4010` | Seller (store, inventory, listings, crossposting, orders, shipping, webhooks): 2,700+ operations | `seller.json` |
| `4011` | Buyer (catalog, cart, checkout, orders, wishlists, offers, cashback): 350+ operations | `buyer.json` |

Both paths work on each port: `/v1/...` and `/api/v1/...`. Production's base URL is `https://crossly.net/api`, so point
an SDK at `http://localhost:4010/api` (seller) or `http://localhost:4011/api` (buyer) and nothing else changes:

```ts
import { createClient } from '@crossly/sdk';
const crossly = createClient({ pat: 'crossly_pat_test', baseUrl: 'http://localhost:4010/api' });
```

```python
from crossly.client import Crossly
crossly = Crossly("crossly_pat_test", base_url="http://localhost:4010/api")
```

```sh
CROSSLY_API_BASE_URL=http://localhost:4010/api CROSSLY_PAT=crossly_pat_test crossly whoami   # @crossly/cli
```

## What it does

- **Auth.** A missing `Authorization: Bearer …` header gets `401`, like the real API. Any token value is accepted.
- **Request validation.** Path, query and body are checked against the spec; an invalid request gets `400` with the
  violations, for example `GET /v1/inventory?limit=1000` (maximum 100) or a body missing required fields.
- **Realistic examples.** The specs ship no examples, so the image build synthesizes one per operation from its
  schema, choosing values by field name (`email`, `priceCents`, `createdAt`, `sku`, `platform`, `imageUrl`…), and a few
  hot endpoints have [curated fixtures](fixtures/) (`getMe`, `listInventory`, `listOrders`, `getBuyerProfile`,
  `listBuyerCatalogSearch`). Every example is validated against its schema at build time; responses are the same on
  every call, so tests can assert on them.
- **CORS on** (any origin, preflights answered), for browser apps.
- **Other status codes on demand:** Prism's `Prefer` header, for example `Prefer: code=404` or `Prefer: code=429`.
- **Random bodies instead:** `-e MOCK_DYNAMIC=true` (Prism's dynamic mode, values from the schema via faker).

Extra endpoints on each port: `GET /healthz` (Docker `HEALTHCHECK`), `GET /` (spec version and example coverage) and
`GET /openapi.json` (the exact spec served, with its examples).

It is a mock, not a simulator: there is no state (a `POST` does not change the next `GET`), no webhooks are sent,
and rate limits are not enforced.

## Configuration

| env | default | |
|---|---|---|
| `SELLER_PORT` / `BUYER_PORT` | `4010` / `4011` | ports inside the container |
| `MOCK_APIS` | `seller,buyer` | serve only one, e.g. `MOCK_APIS=buyer` |
| `MOCK_DYNAMIC` | `false` | `true`: random schema-valid bodies instead of the fixed examples |
| `PRISM_ARGS` | | extra `prism mock` flags, e.g. `--errors` (fail the response on any violation) |

Docker Compose, for an integration test suite:

```yaml
services:
  crossly:
    image: ghcr.io/crossly-dev/crossly-mock:latest
    ports: ['4010:4010', '4011:4011']
    healthcheck:
      test: ['CMD', 'node', '/mock/scripts/healthcheck.mjs']
      interval: 5s
      retries: 30
```

GitHub Actions service container:

```yaml
services:
  crossly:
    image: ghcr.io/crossly-dev/crossly-mock:latest
    ports: ['4010:4010', '4011:4011']
```

## Tags and versions

| tag | |
|---|---|
| `latest` | newest build |
| `0.1.0` (etc.) | built from [crossly-openapi](https://github.com/crossly-dev/crossly-openapi/releases) `v0.1.0`; pin this to keep the API surface fixed |
| `sha-<commit>` | an exact build of this repo |

Images are `linux/amd64` and `linux/arm64` (Apple silicon, Graviton). A [daily workflow](.github/workflows/release.yml)
rebuilds when crossly-openapi publishes a new spec version or this repo's image sources change. Every release:

1. downloads the specs from the crossly-openapi release and verifies their attestation (they must come from that
   repo's release workflow),
2. builds amd64 and runs the [smoke test](scripts/smoke.mjs): named checks (auth, validation, CORS, curated values)
   plus a sweep of **every GET operation of both APIs**, each answering `2xx` with a schema-valid body,
3. pushes the multi-arch image with BuildKit SBOM + provenance, and GitHub attestations (SLSA provenance and an SPDX
   SBOM) stored in the registry,
4. pulls the pushed image on native amd64 and arm64 runners and runs the smoke test again.

Verify an image:

```sh
gh attestation verify oci://ghcr.io/crossly-dev/crossly-mock:latest --repo crossly-dev/crossly-mock
docker buildx imagetools inspect ghcr.io/crossly-dev/crossly-mock:latest --format '{{json .SBOM}}' | head
```

## Develop

The image build has no npm dependencies; `scripts/` is the tooling around it. Everything runs in CI, but locally:

```sh
npm install
gh release download -R crossly-dev/crossly-openapi -p seller.json -p buyer.json -D upstream
node scripts/prepare-specs.mjs --in upstream --out specs
docker build -t crossly-mock . && docker run --rm -p 4010:4010 -p 4011:4011 crossly-mock
node scripts/smoke.mjs --sweep
```

To curate an endpoint, add `fixtures/<seller|buyer>/<operationId>.json`: it is deep-merged over the synthesized
example (arrays element by element), and the build fails if the result does not match the response schema or the
operationId no longer exists.

Security reports: [private vulnerability reporting](https://github.com/crossly-dev/crossly-mock/security/advisories/new).

## License

[MIT](LICENSE). Prism is Apache-2.0.
