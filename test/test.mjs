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

  // Helper: read string from WASM memory
  function readString(ptr) {
    if (!ptr) return null;
    const bytes = [];
    const view = new Uint8Array(memory.buffer);
    let i = ptr;
    while (view[i] !== 0) {
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

  // Recursively find identifier nodes
  function findIdentifiers(node, depth) {
    const results = [];
    if (!node) return results;
    const code = exp.wasm_glsl_node_code(node);
    // IDENTIFIER token is typically a specific code; let's look for string data
    const strPtr = exp.wasm_glsl_node_data_str(node);
    if (strPtr) {
      const str = readString(strPtr);
      if (str) results.push(str);
    }
    const childCount = exp.wasm_glsl_node_child_count(node);
    for (let i = 0; i < childCount; i++) {
      const child = exp.wasm_glsl_node_child(node, i);
      results.push(...findIdentifiers(child, depth + 1));
    }
    return results;
  }

  const root5 = exp.wasm_glsl_get_root(ctx5);
  if (root5) {
    const ids = findIdentifiers(root5, 0);
    console.log(`  Identifiers found: ${ids.join(', ')}`);
  }

  exp.wasm_glsl_parse_free(ctx5);

  console.log('\n=== All tests passed! ===');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
