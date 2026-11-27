#!/usr/bin/env node
/**
 * The container's entrypoint: one Prism mock per API behind a tiny proxy.
 *
 *   seller  :4010  ->  prism on 127.0.0.1:14010  (specs/seller.json)
 *   buyer   :4011  ->  prism on 127.0.0.1:14011  (specs/buyer.json)
 *
 * The proxy exists so the mock answers on BOTH path styles: `/v1/me` (Prism's own routing ignores the server base
 * path) and `/api/v1/me` (the production base URL is https://crossly.net/api, so an SDK pointed at
 * http://localhost:4010/api works unchanged). It also serves:
 *
 *   GET /healthz    200 once Prism is listening, 503 before (the image HEALTHCHECK)
 *   GET /           what this is, the spec version, the example coverage
 *   GET /openapi.json   the spec this port serves (with its examples)
 *
 * Environment:
 *   SELLER_PORT=4010  BUYER_PORT=4011   public ports
 *   MOCK_APIS=seller,buyer              which APIs to serve
 *   MOCK_DYNAMIC=true                   random (faker) bodies instead of the curated/synthesized examples
 *   PRISM_ARGS="..."                    extra flags for `prism mock` (e.g. "--errors")
 *
 * Exits when either Prism exits, so a crash restarts the container instead of leaving a half-alive mock.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = process.env.MOCK_SPECS_DIR || join(ROOT, 'specs');
const manifest = JSON.parse(readFileSync(join(SPECS, 'manifest.json'), 'utf8'));
const wanted = (process.env.MOCK_APIS || 'seller,buyer').split(',').map((s) => s.trim()).filter(Boolean);
const APIS = {
  seller: { port: Number(process.env.SELLER_PORT || 4010), internal: 14010 },
  buyer: { port: Number(process.env.BUYER_PORT || 4011), internal: 14011 },
};
const extra = (process.env.PRISM_ARGS || '').split(/\s+/).filter(Boolean);
if (process.env.MOCK_DYNAMIC === 'true') extra.push('--dynamic');

const children = [];
let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500).unref();
};
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

for (const api of wanted) {
  const cfg = APIS[api];
  if (!cfg) {
    console.error(`unknown api "${api}" in MOCK_APIS (seller, buyer)`);
    process.exit(2);
  }
  const specPath = join(SPECS, `${api}.json`);
  const started = Date.now();
  cfg.ready = false;
  const child = spawn('prism', ['mock', '-h', '127.0.0.1', '-p', String(cfg.internal), '--multiprocess', 'false', ...extra, specPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096' },
  });
  children.push(child);
  const onLine = (stream) => (buf) => {
    for (const line of buf.toString().split('\n')) {
      if (!line.trim()) continue;
      if (!cfg.ready && /Prism is listening/i.test(line)) {
        cfg.ready = true;
        console.log(`[${api}] ready on :${cfg.port} after ${((Date.now() - started) / 1000).toFixed(1)}s`);
      }
      // Per-request lines are useful when debugging an integration; startup route listings are not.
      if (/GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD/.test(line) && !cfg.ready) continue;
      stream.write(`[${api}] ${line}\n`);
    }
  };
  child.stdout.on('data', onLine(process.stdout));
  child.stderr.on('data', onLine(process.stderr));
  child.on('exit', (code, signal) => {
    console.error(`[${api}] prism exited (${signal ?? code})`);
    stop(code || 1);
  });

  const specText = () => readFileSync(specPath);
  http
    .createServer((req, res) => {
      const url = req.url || '/';
      if (url === '/healthz') {
        res.writeHead(cfg.ready ? 200 : 503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: cfg.ready, api }));
      }
      if (url === '/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        return res.end(
          JSON.stringify(
            {
              service: 'crossly-mock',
              api,
              ready: cfg.ready,
              openapiVersion: manifest.openapiVersion,
              coverage: manifest.apis[api],
              usage: `curl -H 'Authorization: Bearer crossly_test' http://localhost:${cfg.port}${api === 'seller' ? '/v1/me' : '/v1/buyer/profile'}`,
              docs: 'https://github.com/crossly-dev/crossly-mock',
            },
            null,
            2,
          ),
        );
      }
      if (url === '/openapi.json' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        return res.end(specText());
      }
      if (!cfg.ready) {
        res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '5' });
        return res.end(JSON.stringify({ error: { code: 'mock_starting', message: 'The mock is still loading the spec; retry in a few seconds.' } }));
      }
      const path = url === '/api' ? '/' : url.startsWith('/api/') ? url.slice(4) : url;
      const upstream = http.request({ host: '127.0.0.1', port: cfg.internal, method: req.method, path, headers: req.headers }, (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      });
      upstream.on('error', (err) => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'mock_upstream', message: err.message } }));
      });
      req.pipe(upstream);
    })
    .listen(cfg.port, '0.0.0.0', () => console.log(`[${api}] listening on :${cfg.port} (loading ${specPath})`));
}
