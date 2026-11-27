// Docker HEALTHCHECK: healthy when every served API's proxy says Prism is listening.
const ports = { seller: process.env.SELLER_PORT || 4010, buyer: process.env.BUYER_PORT || 4011 };
const apis = (process.env.MOCK_APIS || 'seller,buyer').split(',').map((s) => s.trim()).filter(Boolean);
const results = await Promise.all(
  apis.map((api) =>
    fetch(`http://127.0.0.1:${ports[api]}/healthz`, { signal: AbortSignal.timeout(4000) }).then(
      (r) => r.ok,
      () => false,
    ),
  ),
);
process.exit(results.every(Boolean) ? 0 : 1);
