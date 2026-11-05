/**
 * Quick Node.js test for the WASM GLSL parser.
 * Run with: node test/test.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(__dirname, '..', 'glsl-parser.wasm');

async function main() {
  console.log('Loading WASM module...');
  const wasmBytes = readFileSync(wasmPath);

  const memory = new WebAssembly.Memory({ initial: 2, maximum: 256 });

  const { instance } = await WebAssembly.instantiate(wasmBytes, {
    env: {
      __grow_memory: (pages) => {
        if (pages > 0) {
          const result = memory.grow(pages);
          if (result === -1) return 0;
        }
        return memory.buffer.byteLength;
      },
      memory,
    },
  });

  const exp = instance.exports;
  // memory already declared above as import

  // Helper: allocate string in WASM memory
  function allocString(str) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const len = bytes.length;
    const ptr = exp.wasm_malloc(len + 1);
    if (!ptr) throw new Error('wasm_malloc failed');
    const view = new Uint8Array(memory.buffer, ptr, len + 1);
    view.set(bytes);
    view[len] = 0;
    return { ptr, len };
  }

  // Helper: read string from WASM memory. Bounds-safe: stops at the end of
  // linear memory so a bogus pointer can't run the scan off the buffer.
  function readString(ptr) {
    if (!ptr) return null;
    const view = new Uint8Array(memory.buffer);
    if (ptr >= view.length) return null;
    const bytes = [];
    let i = ptr;
    while (i < view.length && view[i] !== 0) {
      bytes.push(view[i]);
      i++;
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  // Test 1: Simple shader
  console.log('\n=== Test 1: Simple vertex shader ===');
  const shader1 = `
    #version 450
    layout(location = 0) in vec3 aPos;
    layout(location = 0) out vec4 fragColor;
    void main() {
        gl_Position = vec4(aPos, 1.0);
        fragColor = vec4(1.0, 0.0, 0.0, 1.0);
    }
  `;

  const ctx1 = exp.wasm_glsl_parse_init();
  console.log(`  Context: ${ctx1}`);

  const { ptr: srcPtr1, len: srcLen1 } = allocString(shader1);
  const err1 = exp.wasm_glsl_parse_string(ctx1, srcPtr1, srcLen1);
  exp.wasm_free(srcPtr1);

  console.log(`  Parse error: ${err1 ? 'YES' : 'NO'}`);

  const root1 = exp.wasm_glsl_get_root(ctx1);
  console.log(`  Root node: ${root1}`);

  if (root1) {
    console.log(`  Root code: ${exp.wasm_glsl_node_code(root1)}`);
    console.log(`  Root children: ${exp.wasm_glsl_node_child_count(root1)}`);
  }

  exp.wasm_glsl_parse_free(ctx1);

  // Test 2: Invalid shader
  console.log('\n=== Test 2: Invalid shader ===');
  const shader2 = `this is not valid glsl {{{`;

  const ctx2 = exp.wasm_glsl_parse_init();
  const { ptr: srcPtr2, len: srcLen2 } = allocString(shader2);
  const err2 = exp.wasm_glsl_parse_string(ctx2, srcPtr2, srcLen2);
  exp.wasm_free(srcPtr2);

  console.log(`  Parse error: ${err2 ? 'YES (expected)' : 'NO'}`);
  exp.wasm_glsl_parse_free(ctx2);

  // Test 3: Empty shader
  console.log('\n=== Test 3: Empty shader ===');
  const ctx3 = exp.wasm_glsl_parse_init();
  const { ptr: srcPtr3, len: srcLen3 } = allocString('');
  const err3 = exp.wasm_glsl_parse_string(ctx3, srcPtr3, srcLen3);
  exp.wasm_free(srcPtr3);

  console.log(`  Parse error: ${err3 ? 'YES' : 'NO'}`);
  const root3 = exp.wasm_glsl_get_root(ctx3);
  console.log(`  Root node: ${root3}`);
  exp.wasm_glsl_parse_free(ctx3);

  // Test 4: Complex fragment shader with identifiers
  console.log('\n=== Test 4: Complex fragment shader ===');
  const shader4 = `
    #version 450
    uniform mat4 uProjection;
    uniform sampler2D uTexture;
    in vec2 vUV;
    out vec4 fragColor;
    void main() {
        fragColor = texture(uTexture, vUV);
    }
  `;

  const ctx4 = exp.wasm_glsl_parse_init();
  const { ptr: srcPtr4, len: srcLen4 } = allocString(shader4);
  const err4 = exp.wasm_glsl_parse_string(ctx4, srcPtr4, srcLen4);
  exp.wasm_free(srcPtr4);

  console.log(`  Parse error: ${err4 ? 'YES' : 'NO'}`);

  const root4 = exp.wasm_glsl_get_root(ctx4);
  if (root4) {
    const code = exp.wasm_glsl_node_code(root4);
    const childCount = exp.wasm_glsl_node_child_count(root4);
    console.log(`  Root code: ${code}, children: ${childCount}`);

    // Walk first level of children
    for (let i = 0; i < Math.min(childCount, 5); i++) {
      const child = exp.wasm_glsl_node_child(root4, i);
      const childCode = exp.wasm_glsl_node_code(child);
      const childCount = exp.wasm_glsl_node_child_count(child);
      console.log(`    Child[${i}]: code=${childCode}, children=${childCount}`);
    }
  }

  exp.wasm_glsl_parse_free(ctx4);

  // Test 5: Identifier string extraction
  console.log('\n=== Test 5: Identifier strings ===');
  const shader5 = `void myFunction(int x) { int myVar = x + 42; }`;

  const ctx5 = exp.wasm_glsl_parse_init();
  const { ptr: srcPtr5, len: srcLen5 } = allocString(shader5);
  const err5 = exp.wasm_glsl_parse_string(ctx5, srcPtr5, srcLen5);
  exp.wasm_free(srcPtr5);

  console.log(`  Parse error: ${err5 ? 'YES' : 'NO'}`);

  // Recursively find identifier nodes. Only IDENTIFIER (code 411) nodes hold
  // a string; the data union of every other node type holds a number or NULL,
  // so reading data_str on them is meaningless (and, on a reused arena chunk,
  // yields stale pointer bits).
  const IDENTIFIER_CODE = 411;
  function findIdentifiers(node) {
    const results = [];
    if (!node) return results;
    if (exp.wasm_glsl_node_code(node) === IDENTIFIER_CODE) {
      const strPtr = exp.wasm_glsl_node_data_str(node);
      if (strPtr) {
        const str = readString(strPtr);
        if (str) results.push(str);
      }
    }
    const childCount = exp.wasm_glsl_node_child_count(node);
    for (let i = 0; i < childCount; i++)
      results.push(...findIdentifiers(exp.wasm_glsl_node_child(node, i)));
    return results;
  }

  const root5 = exp.wasm_glsl_get_root(ctx5);
  if (root5) {
    const ids = findIdentifiers(root5);
    console.log(`  Identifiers found: ${ids.join(', ')}`);
  }

  exp.wasm_glsl_parse_free(ctx5);

  // Test 6: Numeric literals (GLSL 4.1.4 / ESSL 3.00, Appendix A)
  // Regression: the lexer previously rejected exponent forms (1e5, 1.0e5),
  // the trailing-dot form (1.), the f/u/ul/lu suffixes, and hex literals.
  console.log('\n=== Test 6: Numeric literals ===');

  // Token codes from the bison-generated glsl.parser.h (stable: glsl.y unchanged)
  const TOK = { FLOATCONSTANT: 412, INTCONSTANT: 414, UINTCONSTANT: 415, DOT: 445 };
  let numFailures = 0;
  function check(cond, msg) {
    if (cond) {
      console.log(`  ok: ${msg}`);
    } else {
      numFailures++;
      console.error(`  FAIL: ${msg}`);
    }
  }

  function collectNodes(node, code, out) {
    out = out || [];
    if (!node) return out;
    if (exp.wasm_glsl_node_code(node) === code) out.push(node);
    const count = exp.wasm_glsl_node_child_count(node);
    for (let i = 0; i < count; i++)
      collectNodes(exp.wasm_glsl_node_child(node, i), code, out);
    return out;
  }

  function parseSource(src) {
    const ctx = exp.wasm_glsl_parse_init();
    const { ptr, len } = allocString(src);
    const err = exp.wasm_glsl_parse_string(ctx, ptr, len);
    exp.wasm_free(ptr);
    return { ctx, err };
  }

  // [source, token code, data kind, expected value]
  const positives = [
    ['float a = 1e5;',     TOK.FLOATCONSTANT, 'f',  100000],
    ['float b = 1e-5;',    TOK.FLOATCONSTANT, 'f',  1e-5],
    ['float c = 1E+5;',    TOK.FLOATCONSTANT, 'f',  100000],
    ['float d = 1.0e5;',   TOK.FLOATCONSTANT, 'f',  100000],
    ['float e = 1.5e-3;',  TOK.FLOATCONSTANT, 'f',  0.0015],
    ['float f = 0.5E2;',   TOK.FLOATCONSTANT, 'f',  50],
    ['float g = 1.;',      TOK.FLOATCONSTANT, 'f',  1],
    ['float h = 1.e5;',    TOK.FLOATCONSTANT, 'f',  100000],
    ['float i = 1.5f;',    TOK.FLOATCONSTANT, 'f',  1.5],
    ['float j = 2.0f;',    TOK.FLOATCONSTANT, 'f',  2],
    ['float k = 0x1p2;',   TOK.FLOATCONSTANT, 'f',  4],
    ['float l = 0xFFp-2;', TOK.FLOATCONSTANT, 'f',  63.75],
    ['uint m = 1u;',       TOK.UINTCONSTANT,  'ui', 1],
    ['uint n = 12ul;',     TOK.UINTCONSTANT,  'ui', 12],
    ['uint o = 12lu;',     TOK.UINTCONSTANT,  'ui', 12],
    ['uint p = 0xFFu;',    TOK.UINTCONSTANT,  'ui', 255],
    ['int q = 5;',         TOK.INTCONSTANT,   'i',  5],
    ['int r = 0x1F;',      TOK.INTCONSTANT,   'i',  31],
    ['int s = 0XAB;',      TOK.INTCONSTANT,   'i',  171],
  ];

  for (const [src, code, kind, expected] of positives) {
    const { ctx, err } = parseSource(src);
    if (err) {
      check(false, `${src} -> parses`);
      exp.wasm_glsl_parse_free(ctx);
      continue;
    }
    const root = exp.wasm_glsl_get_root(ctx);
    const nodes = collectNodes(root, code);
    let ok = nodes.length === 1;
    let detail = `found ${nodes.length} token-${code} node(s)`;
    if (ok) {
      const got = kind === 'f' ? exp.wasm_glsl_node_data_f(nodes[0])
                : kind === 'ui' ? exp.wasm_glsl_node_data_ui(nodes[0])
                : exp.wasm_glsl_node_data_i(nodes[0]);
      const tol = 1e-6 * Math.max(1, Math.abs(expected));
      ok = Math.abs(got - expected) <= tol;
      detail = `value ${got} (expected ${expected})`;
      // 1.e5 used to parse as INTCONSTANT DOT IDENTIFIER (a member access on
      // an int literal); make sure that false positive is gone.
      if (src.includes('1.e5'))
        ok = ok && collectNodes(root, TOK.DOT).length === 0;
    }
    check(ok, `${src} -> ${detail}`);
    exp.wasm_glsl_parse_free(ctx);
  }

  // Invalid literals must be rejected, not partially lexed
  const negatives = ['5e', '1e', '0x', '1.5g', '0x1.8p1'];
  for (const lit of negatives) {
    const src = `float x = ${lit};`;
    const { ctx, err } = parseSource(src);
    check(err !== 0, `${src} -> rejected`);
    exp.wasm_glsl_parse_free(ctx);
  }

  if (numFailures) {
    console.error(`\n${numFailures} numeric literal check(s) failed`);
    process.exit(1);
  }

  console.log('\n=== All tests passed! ===');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
