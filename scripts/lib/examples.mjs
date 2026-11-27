/**
 * Deterministic, realistic example bodies from OpenAPI 3.0 schemas.
 *
 *   const synth = makeSynth(spec); synth(schema)  ->  a value that should validate against `schema`
 *
 * The Crossly specs carry no examples, and a schema-only mock answers `"string"` and `0` everywhere. This walks the
 * schema and picks values by type, format and PROPERTY NAME (`email`, `priceCents`, `createdAt`, `imageUrl`, `sku`,
 * `platform`…), so a listing looks like a listing. Same input, same output: tests can assert on it.
 *
 * Not a validator: prepare-specs.mjs checks every result with Ajv and drops any example that does not validate
 * (Prism then falls back to its own schema-based value for that one operation).
 */
import { createHash } from 'node:crypto';

const PRODUCTS = [
  "Vintage Levi's 501 Jeans 32x30",
  'Nike Air Max 90 Sneakers, Size 10',
  'Patagonia Better Sweater Fleece Jacket',
  'Coach Leather Crossbody Bag',
  'Pokémon Charizard Holo Card (Base Set)',
  'Le Creuset Dutch Oven 5.5 qt',
];
const BRANDS = ["Levi's", 'Nike', 'Patagonia', 'Coach', 'Pokémon', 'Le Creuset'];
const PEOPLE = ['Alex Morgan', 'Sam Rivera', 'Jordan Kim', 'Taylor Brooks'];
const USERNAMES = ['thriftqueen', 'vintagevault', 'sneakerstash', 'closetcleanout'];
const EMAILS = ['alex.morgan@example.com', 'sam.rivera@example.com', 'jordan.kim@example.com', 'taylor.brooks@example.com'];
const PLATFORMS = ['ebay', 'poshmark', 'mercari', 'depop', 'etsy', 'grailed'];
const CARRIERS = ['USPS', 'UPS', 'FedEx'];
const COLORS = ['Indigo', 'Black', 'Heather Grey', 'Brown'];
const SIZES = ['M', 'L', '10', 'One Size'];
const CONDITIONS = ['Pre-owned: excellent', 'New with tags', 'Pre-owned: good'];
const TAGS = ['vintage', 'denim', 'streetwear', 'y2k'];
const SENTENCES = [
  'Gently worn, no stains or holes. Ships within one business day.',
  'Smoke-free home. Measurements in the photos.',
  'Bundle and save: 15% off two or more items.',
];
const BASE_TIME = Date.UTC(2026, 9, 15, 14, 32, 0);

const pick = (list, i) => list[((i % list.length) + list.length) % list.length];
const words = (key) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
const uuid = (seed) => {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const iso = (i, offsetDays = 0) => new Date(BASE_TIME - (i * 3 + offsetDays) * 86400000 - i * 3600000).toISOString();

function stringFor(key, s, i, path) {
  const k = key.toLowerCase();
  const f = s.format;
  if (f === 'date-time') return iso(i, /expires|ends|due|until|deadline/.test(k) ? -30 : 0);
  if (f === 'date') return iso(i).slice(0, 10);
  if (f === 'uuid') return uuid(`${path}:${i}`);
  if (f === 'email') return pick(EMAILS, i);
  if (f === 'uri' || f === 'url') return /image|photo|thumb|avatar|logo|cover/.test(k) ? `https://images.example.com/crossly/item-${i + 1}.jpg` : `https://example.com/${slugify(words(key)) || 'resource'}/${i + 1}`;
  if (f === 'ipv4') return '203.0.113.10';
  if (f === 'byte') return 'ZXhhbXBsZQ==';

  if (/^(id|uuid)$/.test(k) || /(Id|ID|_id)$/.test(key)) return uuid(`${key}:${i}`);
  if (k.includes('email')) return pick(EMAILS, i);
  if (/(image|photo|thumbnail|avatar|logo|cover|picture)(url)?s?$/.test(k) || k === 'images') return `https://images.example.com/crossly/item-${i + 1}.jpg`;
  if (/(url|uri|href|link|website)$/.test(k)) return `https://crossly.net/${k.includes('label') ? 'labels' : 'l'}/${slugify(pick(PRODUCTS, i))}`;
  if (/(^|\.)(at|date|time|timestamp)$|(At|Date|On)$/.test(key)) return iso(i);
  if (k === 'sku' || k.endsWith('sku')) return `SKU-${10042 + i}`;
  if (k === 'slug' || k.endsWith('slug')) return slugify(pick(PRODUCTS, i));
  if (k.includes('currency')) return 'USD';
  if (k === 'country' || k.endsWith('countrycode') || k === 'countryiso') return 'US';
  if (k === 'city') return 'Austin';
  if (k === 'state' && path.toLowerCase().includes('address')) return 'TX';
  if (/^(zip|zipcode|postalcode|postcode)$/.test(k)) return '78701';
  if (/^(line1|street|street1|address1|addressline1)$/.test(k)) return '500 Congress Ave';
  if (/^(line2|street2|address2)$/.test(k)) return 'Suite 210';
  if (k.includes('phone')) return '+1 512 555 0142';
  if (k === 'brand' || k.endsWith('brand')) return pick(BRANDS, i);
  if (/^(title|defaulttitle|itemtitle|listingtitle|producttitle)$/.test(k)) return pick(PRODUCTS, i);
  if (/^(displayname|fullname|buyername|sellername|sellerdisplayname|recipientname|contactname|customername)$/.test(k)) return pick(PEOPLE, i);
  if (k === 'firstname') return pick(PEOPLE, i).split(' ')[0];
  if (k === 'lastname') return pick(PEOPLE, i).split(' ')[1];
  if (/username$|handle$/.test(k)) return pick(USERNAMES, i);
  if (k === 'name') return /user|member|buyer|seller|contact|owner|person|profile|team|recipient/.test(path.toLowerCase()) ? pick(PEOPLE, i) : pick(PRODUCTS, i);
  if (/^(description|notes|note|bio|message|body|text|comment|details|summary|explanation)$/.test(k)) return pick(SENTENCES, i);
  if (k.includes('reason')) return 'Buyer requested cancellation';
  if (k === 'platform' || k === 'marketplace' || k.endsWith('platform')) return pick(PLATFORMS, i);
  if (k.includes('carrier')) return pick(CARRIERS, i);
  if (k.includes('trackingnumber')) return `94001118992231974${28490 + i}`;
  if (k === 'service' || k.endsWith('service')) return 'Ground Advantage';
  if (k === 'status' || k.endsWith('status')) return 'active';
  if (k === 'condition') return pick(CONDITIONS, i);
  if (k === 'size') return pick(SIZES, i);
  if (k === 'color' || k === 'colour') return pick(COLORS, i);
  if (k === 'tag' || k === 'tags' || k === 'label' || k === 'labels') return pick(TAGS, i);
  if (k.includes('timezone') || k === 'tz') return 'America/Chicago';
  if (k === 'locale') return 'en-US';
  if (k === 'language' || k === 'lang') return 'en';
  if (k === 'version') return '1.0.0';
  if (k.includes('token')) return `tok_${uuid(`${key}:${i}`).replace(/-/g, '').slice(0, 24)}`;
  if (k.includes('prefix')) return 'crossly_pat_a1b2';
  if (/(price|amount|cost|fee|total|balance|subtotal)$/.test(k)) return (45 + i * 12.5).toFixed(2);
  if (/^(weight|weightlb|weightoz)$/.test(k) || k.startsWith('weight')) return '1.2';
  if (k.startsWith('dimension') || /^(length|width|height)(in|cm)?$/.test(k)) return String(12 - i);
  if (k === 'code') return `CODE${100 + i}`;
  if (k === 'source') return 'manual';
  if (k === 'kind' || k === 'type') return 'standard';
  if (k === 'key') return `key-${i + 1}`;
  if (k === 'tier' || k.endsWith('tier')) return 'pro';
  if (k === 'scope' || k === 'scopes') return pick(['inventory:read', 'listings:write', 'orders:read'], i);
  if (k === 'hex' || k.endsWith('hex') || k.endsWith('colorhex')) return '#3b5bdb';
  const w = words(key);
  return w ? `${w.charAt(0).toUpperCase()}${w.slice(1)} ${i + 1}` : `Example ${i + 1}`;
}

function numberFor(key, s, i) {
  const k = key.toLowerCase();
  let v;
  if (k.endsWith('cents') || k.endsWith('minor')) v = 4500 + i * 1250;
  else if (k === 'page') v = 1;
  else if (k === 'limit' || k === 'perpage' || k === 'pagesize') v = 25;
  else if (k === 'totalpages' || k === 'pages') v = 3;
  else if (k === 'total' || k.endsWith('count') || k === 'count') v = 42 + i;
  else if (/quantity|qty|units|stock/.test(k)) v = 1 + i;
  else if (/(price|amount|cost|fee|balance|subtotal|charged|collected)$/.test(k)) v = 45 + i * 12.5;
  else if (/percent|pct|rate$/.test(k)) v = 15;
  else if (k === 'year') v = 2024;
  else if (k === 'lat' || k === 'latitude') v = 30.2672;
  else if (k === 'lng' || k === 'lon' || k === 'longitude') v = -97.7431;
  else if (/days|hours|minutes/.test(k)) v = 2;
  else if (/score|rating/.test(k)) v = 4.8;
  else if (k.endsWith('ms') || k.includes('duration')) v = 1200;
  else v = i + 1;
  const min = typeof s.minimum === 'number' ? s.minimum + (s.exclusiveMinimum === true ? (s.type === 'integer' ? 1 : 0.01) : 0) : -Infinity;
  const max = typeof s.maximum === 'number' ? s.maximum - (s.exclusiveMaximum === true ? (s.type === 'integer' ? 1 : 0.01) : 0) : Infinity;
  v = Math.min(Math.max(v, min), max);
  if (s.type === 'integer') v = Math.round(v) < min ? Math.ceil(v) : Math.round(v) > max ? Math.floor(v) : Math.round(v);
  if (typeof s.multipleOf === 'number' && s.multipleOf > 0) v = Math.ceil(v / s.multipleOf) * s.multipleOf;
  return v;
}

function booleanFor(key) {
  return /^(is)?(enabled|active|ok|success|verified|connected|available|live|valid|published|visible|allowed|eligible)$/i.test(key) || /^(ok|success)$/i.test(key);
}

export function makeSynth(spec, { maxDepth = 7 } = {}) {
  const schemas = spec.components?.schemas ?? {};
  const deref = (s) => {
    let guard = 0;
    while (s?.$ref && guard++ < 50) s = schemas[s.$ref.split('/').pop()];
    return s ?? {};
  };

  function gen(raw, key, depth, i, path) {
    const s = deref(raw);
    if (s.allOf) {
      const parts = s.allOf.map((p) => gen(p, key, depth, i, path));
      const own = { ...s };
      delete own.allOf;
      if (Object.keys(own).some((k) => ['properties', 'type'].includes(k))) parts.push(gen(own, key, depth, i, path));
      return parts.every((p) => p && typeof p === 'object' && !Array.isArray(p)) ? Object.assign({}, ...parts) : parts[parts.length - 1];
    }
    const alt = s.oneOf ?? s.anyOf;
    if (alt?.length) {
      const choice = alt.find((a) => deref(a).type !== 'null' && !(deref(a).enum?.length === 1 && deref(a).enum[0] === null)) ?? alt[0];
      return gen(choice, key, depth, i, path);
    }
    if ('const' in s) return s.const;
    if (Array.isArray(s.enum) && s.enum.length) {
      const values = s.enum.filter((v) => v !== null);
      return values.length ? pick(values, i) : null;
    }
    if (s.default !== undefined && typeof s.default !== 'object') return s.default;
    if (depth > maxDepth) {
      if (s.nullable) return null;
      if (s.type === 'array') return [];
    }
    switch (s.type) {
      case 'string': {
        let v = stringFor(key, s, i, path);
        if (typeof s.maxLength === 'number' && v.length > s.maxLength) v = v.slice(0, s.maxLength);
        if (typeof s.minLength === 'number' && v.length < s.minLength) v = v.padEnd(s.minLength, 'x');
        return v;
      }
      case 'integer':
      case 'number':
        return numberFor(key, s, i);
      case 'boolean':
        return booleanFor(key);
      case 'array': {
        const min = s.minItems ?? 0;
        const max = s.maxItems ?? Infinity;
        const want = key === 'data' || key === 'items' || key === 'results' ? 3 : 2;
        const n = Math.max(min, Math.min(depth >= 3 ? 1 : want, max));
        const singular = key.endsWith('ies') ? `${key.slice(0, -3)}y` : key.endsWith('s') ? key.slice(0, -1) : key;
        const items = [];
        for (let j = 0; j < n; j++) items.push(gen(s.items ?? {}, key === 'images' || key === 'tags' || key === 'labels' || key === 'scopes' ? key : singular, depth + 1, i + j, `${path}/${key}`));
        return items;
      }
      case 'object':
      default: {
        if (!s.type && !s.properties && !s.additionalProperties) {
          // Untyped ("anything"): a small object reads better than a placeholder string.
          return key === 'details' || key === 'meta' || key === 'metadata' ? {} : stringFor(key, { type: 'string' }, i, path);
        }
        if (depth > maxDepth + 5) return {};
        const out = {};
        const props = s.properties ?? {};
        const required = new Set(s.required ?? []);
        for (const [name, ps] of Object.entries(props)) {
          if (depth > maxDepth && !required.has(name)) continue;
          out[name] = gen(ps, name, depth + 1, i, `${path}/${name}`);
        }
        if (!Object.keys(props).length && s.additionalProperties && typeof s.additionalProperties === 'object' && Object.keys(s.additionalProperties).length) {
          out[pick(['ebay', 'poshmark'], i)] = gen(s.additionalProperties, 'value', depth + 1, i, `${path}/*`);
        }
        return out;
      }
    }
  }

  return (schema, key = 'root') => gen(schema, key, 0, 0, '');
}

/** Deep merge for curated fixtures: objects merge by key, arrays element-wise (extra override elements append). */
export function deepMerge(base, over) {
  if (Array.isArray(base) && Array.isArray(over)) {
    const out = [...base];
    over.forEach((v, j) => {
      out[j] = j < base.length ? deepMerge(base[j], v) : v;
    });
    return out;
  }
  if (base && over && typeof base === 'object' && typeof over === 'object' && !Array.isArray(base) && !Array.isArray(over)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
    return out;
  }
  return over;
}
