#!/usr/bin/env node
/**
 * Turn the published Crossly specs into the specs the mock serves.
 *
 *   node scripts/prepare-specs.mjs --in <dir with seller.json, buyer.json> --out specs [--version v0.1.0]
 *
 * 1. normalize30: fix the few OpenAPI 3.1 constructs in the 3.0.3 documents so Prism accepts them.
 * 2. For every operation's success response (lowest 2xx, application/json), synthesize a realistic example from the
 *    schema (scripts/lib/examples.mjs), deep-merge the curated fixture fixtures/<api>/<operationId>.json over it if
 *    there is one, and validate the result with Ajv. Valid -> set as the media type's `example` (Prism's static mode
 *    serves it). Invalid -> drop it (Prism falls back to a schema-generated value) and count it. A curated fixture
 *    that does not validate FAILS the build: a fixture must be a body the real API could send.
 * 3. Write <out>/<api>.json and <out>/manifest.json (source version, sha256, example coverage).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { deepMerge, makeSynth } from './lib/examples.mjs';
import { createValidator, normalize30, operations, successJson } from './lib/schema.mjs';

const { values } = parseArgs({ options: { in: { type: 'string' }, out: { type: 'string', default: 'specs' }, version: { type: 'string', default: 'unknown' } } });
if (!values.in) {
  console.error('usage: prepare-specs.mjs --in <dir> --out <dir> [--version vX.Y.Z]');
  process.exit(2);
}
mkdirSync(values.out, { recursive: true });

const manifest = { openapiVersion: values.version, source: 'https://github.com/crossly-dev/crossly-openapi', apis: {} };
let curatedFailures = 0;

for (const api of ['seller', 'buyer']) {
  const text = readFileSync(join(values.in, `${api}.json`), 'utf8');
  const spec = JSON.parse(text);
  const fixes = normalize30(spec);
  for (const f of fixes) console.log(`${api}: normalized ${f}`);

  const synth = makeSynth(spec);
  const validator = createValidator(spec);
  const fixtureDir = join('fixtures', api);
  const fixtures = new Map(
    existsSync(fixtureDir)
      ? readdirSync(fixtureDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(fixtureDir, f), 'utf8'))])
      : [],
  );
  const usedFixtures = new Set();
  const stats = { operations: 0, withJsonSuccess: 0, examples: 0, curated: 0, dropped: [] };

  for (const { method, path, op } of operations(spec)) {
    stats.operations++;
    const success = successJson(op);
    if (!success) continue;
    stats.withJsonSuccess++;
    let body = synth(success.media.schema, 'root');
    const fixture = op.operationId && fixtures.get(op.operationId);
    if (fixture) {
      usedFixtures.add(op.operationId);
      body = deepMerge(body, fixture);
    }
    const errors = validator.check(success.media.schema, body);
    if (errors) {
      const why = errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
      if (fixture) {
        console.error(`::error file=fixtures/${api}/${op.operationId}.json::curated fixture does not match the ${op.operationId} response schema: ${why}`);
        curatedFailures++;
      }
      stats.dropped.push(`${method.toUpperCase()} ${path} (${op.operationId}): ${why}`);
      continue;
    }
    delete success.media.examples;
    success.media.example = body;
    stats.examples++;
    if (fixture) stats.curated++;
  }
  for (const id of fixtures.keys()) {
    if (!usedFixtures.has(id)) {
      console.error(`::error file=fixtures/${api}/${id}.json::no ${api} operation has operationId "${id}" (renamed or removed upstream?)`);
      curatedFailures++;
    }
  }

  const out = JSON.stringify(spec);
  writeFileSync(join(values.out, `${api}.json`), out);
  manifest.apis[api] = {
    title: spec.info?.title,
    sourceSha256: createHash('sha256').update(text).digest('hex'),
    operations: stats.operations,
    successResponses: stats.withJsonSuccess,
    examples: stats.examples,
    curated: stats.curated,
    dropped: stats.dropped.length,
    normalized: fixes.length,
    bytes: out.length,
  };
  console.log(
    `${api}: ${stats.operations} operations, ${stats.examples}/${stats.withJsonSuccess} success bodies with a valid example (${stats.curated} curated), ${stats.dropped.length} dropped, ${(out.length / 1e6).toFixed(1)} MB`,
  );
  for (const d of stats.dropped.slice(0, 15)) console.log(`  dropped: ${d}`);
  if (stats.dropped.length > 15) console.log(`  … and ${stats.dropped.length - 15} more`);
}

writeFileSync(join(values.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
if (curatedFailures) {
  console.error(`${curatedFailures} curated fixture problem(s)`);
  process.exit(1);
}
