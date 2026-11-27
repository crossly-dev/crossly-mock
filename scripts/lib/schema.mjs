/**
 * OpenAPI 3.0 schema helpers shared by prepare-specs.mjs and smoke.mjs.
 *
 *   normalize30(spec)        fix OpenAPI 3.1 / JSON Schema 2019 constructs that leak into a 3.0.3 document, in place,
 *                            so strict 3.0 tooling (Prism) accepts it. Returns the list of fixes.
 *   createValidator(spec)    { check(schema, data) -> null | errors[] } with Ajv, for 3.0 schemas
 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Walk every schema-shaped node under components.schemas and the inline schemas of paths. */
function walk(node, fn, path = '#') {
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, fn, `${path}/${i}`));
  if (!isObj(node)) return;
  fn(node, path);
  for (const [k, v] of Object.entries(node)) walk(v, fn, `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
}

export function normalize30(spec) {
  const fixes = [];
  walk(spec, (n, path) => {
    // type: ["null", "string"]  ->  type: string, nullable: true
    if (Array.isArray(n.type)) {
      const types = n.type.filter((t) => t !== 'null');
      if (n.type.includes('null')) n.nullable = true;
      if (types.length === 1) n.type = types[0];
      else {
        delete n.type;
        if (types.length > 1) n.anyOf = types.map((t) => ({ type: t }));
      }
      fixes.push(`${path}/type: type array -> 3.0 type + nullable`);
    } else if (n.type === 'null') {
      delete n.type;
      n.nullable = true;
      n.enum = [null];
      fixes.push(`${path}/type: "null" -> nullable enum [null]`);
    }
    // exclusiveMinimum: 0  ->  minimum: 0, exclusiveMinimum: true
    for (const [ex, bound] of [['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum']]) {
      if (typeof n[ex] === 'number' && typeof n.type === 'string' && ['number', 'integer'].includes(n.type)) {
        n[bound] = n[ex];
        n[ex] = true;
        fixes.push(`${path}/${ex}: numeric -> ${bound} + boolean`);
      }
    }
    if ('const' in n && !('enum' in n) && typeof n.type === 'string') {
      n.enum = [n.const];
      delete n.const;
      fixes.push(`${path}/const -> enum`);
    }
  });
  return fixes;
}

/** OpenAPI 3.0 schema -> JSON Schema draft-07 (what Ajv validates). Pure: returns a converted copy. */
function toJsonSchema(node) {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (!isObj(node)) return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') out.$ref = v.startsWith('#/') ? `spec${v}` : v;
    else if (['example', 'examples', 'discriminator', 'xml', 'externalDocs', 'deprecated', 'readOnly', 'writeOnly', 'nullable'].includes(k)) continue;
    else if (k === 'properties' && isObj(v)) out.properties = Object.fromEntries(Object.entries(v).map(([p, s]) => [p, toJsonSchema(s)]));
    else out[k] = toJsonSchema(v);
  }
  if (node.exclusiveMinimum === true && typeof node.minimum === 'number') {
    out.exclusiveMinimum = node.minimum;
    delete out.minimum;
  } else if (typeof node.exclusiveMinimum === 'boolean') delete out.exclusiveMinimum;
  if (node.exclusiveMaximum === true && typeof node.maximum === 'number') {
    out.exclusiveMaximum = node.maximum;
    delete out.maximum;
  } else if (typeof node.exclusiveMaximum === 'boolean') delete out.exclusiveMaximum;
  if (node.nullable === true) {
    if (typeof out.type === 'string') {
      out.type = [out.type, 'null'];
      if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
    } else if (!Array.isArray(out.type)) {
      return { anyOf: [out, { type: 'null' }] };
    }
  }
  return out;
}

export function createValidator(spec) {
  const ajv = new Ajv({ strict: false, allErrors: false, validateSchema: false, logger: false });
  addFormats(ajv);
  ajv.addSchema({ $id: 'spec', components: { schemas: toJsonSchema(spec.components?.schemas ?? {}) } });
  const cache = new Map();
  return {
    check(schema, data) {
      const key = schema.$ref ?? JSON.stringify(schema);
      let fn = cache.get(key);
      if (!fn) {
        fn = ajv.compile(toJsonSchema(schema));
        cache.set(key, fn);
      }
      return fn(data) ? null : fn.errors;
    },
  };
}

export const METHODS = ['get', 'put', 'post', 'delete', 'patch'];

/** [{ method, path, op }] for every operation. */
export function operations(spec) {
  const out = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) if (item[method]) out.push({ method, path, op: item[method], pathParams: item.parameters ?? [] });
  }
  return out;
}

/** The lowest 2xx response with an application/json schema: { code, media } or null. */
export function successJson(op) {
  const codes = Object.keys(op.responses ?? {}).filter((c) => /^2\d\d$/.test(c)).sort();
  for (const code of codes) {
    const media = op.responses[code].content?.['application/json'];
    if (media?.schema) return { code, media };
  }
  return null;
}
