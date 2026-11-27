# Changelog

Changes to the mock itself. What changed in the API it serves is in each
[crossly-openapi release](https://github.com/crossly-dev/crossly-openapi/releases); every image build is listed under
its GitHub Release here.

## Unreleased

- First version: Prism 5.16 on Node 24, seller API on `:4010` and buyer API on `:4011`, both also under `/api`.
- Examples for every operation's success response, synthesized from the schema by field name and validated with
  Ajv at build time; curated fixtures for `getMe`, `listInventory`, `listOrders`, `getBuyerProfile`,
  `listBuyerCatalogSearch`.
- Specs come from the latest crossly-openapi release, attestation-verified; the three OpenAPI 3.1 constructs in the
  3.0.3 seller spec are normalized so Prism loads it.
- Multi-arch image (amd64, arm64) with BuildKit SBOM + provenance and GitHub attestations (SLSA provenance, SPDX SBOM)
  pushed to GHCR; smoke-tested before the push and again natively on both architectures after it.
