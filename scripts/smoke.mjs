#!/usr/bin/env node
/**
 * Smoke-test a running crossly-mock: real endpoints, real auth header, bodies validated against the spec.
 *
 *   node scripts/smoke.mjs --seller http://localhost:4010 --buyer http://localhost:4011 --specs specs [--sweep]
 *
 * Named checks (always):
 *   - GET /v1/me, /v1/inventory, /v1/orders (seller), /v1/buyer/profile, /v1/buyer/catalog/search (buyer) with a
 *     bearer token -> 2xx and a body that validates against the operation's response schema; curated values present
 *   - the same under the production base path (/api/v1/me)
 *   - no token -> 401; an out-of-range query parameter -> 4xx (request validation is on)
 *   - a CORS preflight is answered with Access-Control-Allow-Origin
 * --sweep: every GET operation of both APIs (path and required query parameters filled from their schemas) must
 *   answer 2xx with a schema-valid JSON body.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { makeSynth } from './lib/examples.mjs';
import { createValidator, operations, successJson } from './lib/schema.mjs';

const { values } = parseArgs({
  options: {
    seller: { type: 'string', default: 'http://localhost:4010' },
    buyer: { type: 'string', default: 'http://localhost:4011' },
    specs: { type: 'string', default: 'specs' },
    sweep: { type: 'boolean', default: false },
    token: { type: 'string', default: 'crossly_pat_smoke_test_token' },
  },
});

const apis = {};
for (const api of ['seller', 'buyer']) {
  const spec = JSON.parse(readFileSync(join(values.specs, `${api}.json`), 'utf8'));
  const byKey = new Map(operations(spec).map((o) => [`${o.method.toUpperCase()} ${o.path}`, o]));
  apis[api] = { spec, base: values[api], validator: createValidator(spec), synth: makeSynth(spec), byKey };
}

const auth = { Authorization: `Bearer ${values.token}`, Accept: 'application/json' };
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`FAIL ${msg}`);
};
const pass = (msg) => console.log(`ok   ${msg}`);

async function call(api, method, path, { headers = auth, body } = {}) {
  const res = await fetch(`${apis[api].base}${path}`, {
    method,
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

/** 2xx + schema-valid body for the operation `METHOD /template` reached at `url`. Returns the body. */
async function expectValid(api, key, url, label = `${api} ${key}`) {
  const o = apis[api].byKey.get(key);
  if (!o) return fail(`${label}: not in the ${api} spec`);
  const [method] = key.split(' ');
  const r = await call(api, method, url);
  if (r.status < 200 || r.status > 299) return fail(`${label} -> ${r.status} ${r.text.slice(0, 200)}`);
  const success = successJson(o.op);
  if (!success) return pass(`${label} -> ${r.status} (no JSON schema to check)`);
  if (r.json === undefined) return fail(`${label} -> ${r.status} but the body is not JSON: ${r.text.slice(0, 120)}`);
  const errors = apis[api].validator.check(success.media.schema, r.json);
  if (errors) return fail(`${label} -> ${r.status} body does not match the schema: ${errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`);
  pass(`${label} -> ${r.status}, body matches ${success.media.schema.$ref?.split('/').pop() ?? 'the inline schema'}`);
  return r.json;
}

// ── named checks ────────────────────────────────────────────────────────────────────────────────────────────────
const me = await expectValid('seller', 'GET /v1/me', '/v1/me');
if (me && me.email !== 'alex.morgan@example.com') fail(`seller GET /v1/me: expected the curated email, got ${JSON.stringify(me.email)}`);
await expectValid('seller', 'GET /v1/me', '/api/v1/me', 'seller GET /api/v1/me (production base path)');
const inv = await expectValid('seller', 'GET /v1/inventory', '/v1/inventory?limit=5&kind=physical');
if (inv && !(Array.isArray(inv.data) && inv.data.length && inv.data[0].defaultTitle)) fail('seller GET /v1/inventory: expected rows with defaultTitle');
await expectValid('seller', 'GET /v1/orders', '/v1/orders?limit=10');
const profile = await expectValid('buyer', 'GET /v1/buyer/profile', '/v1/buyer/profile');
if (profile && typeof profile.data?.bucksBalanceCents !== 'number') fail('buyer GET /v1/buyer/profile: expected data.bucksBalanceCents');
await expectValid('buyer', 'GET /v1/buyer/catalog/search', '/v1/buyer/catalog/search?q=jeans');
await expectValid('buyer', 'GET /v1/buyer/cart', '/api/v1/buyer/cart', 'buyer GET /api/v1/buyer/cart (production base path)');

{
  const r = await call('seller', 'GET', '/v1/me', { headers: { Accept: 'application/json' } });
  r.status === 401 ? pass('seller GET /v1/me without a token -> 401') : fail(`seller GET /v1/me without a token -> ${r.status}, want 401`);
  const b = await call('buyer', 'GET', '/v1/buyer/profile', { headers: { Accept: 'application/json' } });
  b.status === 401 ? pass('buyer GET /v1/buyer/profile without a token -> 401') : fail(`buyer GET /v1/buyer/profile without a token -> ${b.status}, want 401`);
}
{
  const r = await call('seller', 'GET', '/v1/inventory?limit=1000');
  r.status >= 400 && r.status < 500
    ? pass(`seller GET /v1/inventory?limit=1000 (max 100) -> ${r.status} (request validation is on)`)
    : fail(`seller GET /v1/inventory?limit=1000 -> ${r.status}, want a 4xx validation error`);
  const k = await call('seller', 'GET', '/v1/inventory?kind=spaceship');
  k.status >= 400 && k.status < 500 ? pass(`seller GET /v1/inventory?kind=spaceship (enum) -> ${k.status}`) : fail(`seller GET /v1/inventory?kind=spaceship -> ${k.status}, want 4xx`);
}
{
  // A request body missing its required fields must be refused.
  const target = [...apis.seller.byKey.values()].find((o) => {
    const schema = o.op.requestBody?.content?.['application/json']?.schema;
    const s = schema?.$ref ? apis.seller.spec.components.schemas[schema.$ref.split('/').pop()] : schema;
    return o.method === 'post' && !o.path.includes('{') && o.op.requestBody?.required && s?.required?.length;
  });
  if (target) {
    const r = await call('seller', 'POST', target.path, { body: {} });
    r.status >= 400 && r.status < 500
      ? pass(`seller POST ${target.path} with {} (missing required fields) -> ${r.status}`)
      : fail(`seller POST ${target.path} with {} -> ${r.status}, want 4xx`);
  }
}
{
  const r = await fetch(`${values.seller}/v1/me`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
  });
  const allow = r.headers.get('access-control-allow-origin');
  allow ? pass(`CORS preflight -> ${r.status}, Access-Control-Allow-Origin: ${allow}`) : fail(`CORS preflight -> ${r.status} without Access-Control-Allow-Origin`);
}

// ── sweep ───────────────────────────────────────────────────────────────────────────────────────────────────────
if (values.sweep) {
  for (const api of ['seller', 'buyer']) {
    const { synth } = apis[api];
    const gets = [...apis[api].byKey.values()].filter((o) => o.method === 'get' && successJson(o.op));
    const bad = [];
    let ok = 0;
    let next = 0;
    const urlFor = (o) => {
      const params = [...o.pathParams, ...(o.op.parameters ?? [])];
      let path = o.path;
      const query = new URLSearchParams();
      for (const p of params) {
        const v = p.schema ? synth(p.schema, p.name) : 'example';
        const s = Array.isArray(v) ? v.join(',') : typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (p.in === 'path') path = path.replace(`{${p.name}}`, encodeURIComponent(s));
        else if (p.in === 'query' && p.required) query.set(p.name, s);
      }
      return query.size ? `${path}?${query}` : path;
    };
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (next < gets.length) {
          const o = gets[next++];
          const url = urlFor(o);
          try {
            const r = await call(api, 'GET', url);
            const schema = successJson(o.op).media.schema;
            const good = r.status >= 200 && r.status < 300 && r.json !== undefined;
            const errors = good ? apis[api].validator.check(schema, r.json) : null;
            if (!good) bad.push(`GET ${url} (${o.op.operationId}) -> ${r.status} ${r.text.slice(0, 160)}`);
            else if (errors) bad.push(`GET ${url} (${o.op.operationId}) -> ${r.status} schema: ${errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`);
            else ok++;
          } catch (err) {
            bad.push(`GET ${url} (${o.op.operationId}) -> ${err.message}`);
          }
        }
      }),
    );
    if (bad.length) {
      fail(`${api} sweep: ${bad.length}/${gets.length} GET operations did not return a schema-valid 2xx`);
      for (const b of bad.slice(0, 40)) console.log(`       ${b}`);
      if (bad.length > 40) console.log(`       … and ${bad.length - 40} more`);
    } else pass(`${api} sweep: all ${ok} GET operations returned a schema-valid 2xx`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
