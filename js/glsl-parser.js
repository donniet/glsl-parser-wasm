/**
 * glsl-parser-wasm — JavaScript loader and API wrapper
 *
 * Usage:
 *   const { parse } = await import('./glsl-parser.js');
 *   const ast = parse('void main() { gl_FragColor = vec4(1.0); }');
 */

/* ------------------------------------------------------------------ */
/*  Module state                                                      */
/* ------------------------------------------------------------------ */
let _exports   = null;
let _memory    = null;
let _heap_u8   = null;

/* Cached function references */
let _f_init      = null;
let _f_parse     = null;
let _f_get_root  = null;
let _f_node_code = null;
let _f_node_cc   = null;
let _f_node_child= null;
let _f_data_d    = null;
let _f_data_f    = null;
let _f_data_i    = null;
let _f_data_ui   = null;
let _f_data_b    = null;
let _f_data_str  = null;
let _f_free_ctx  = null;
let _f_malloc    = null;
let _f_free      = null;

/* Token name lookup (populated from glsl.parser.h token values) */
const TOKEN_NAMES = {};

/**
 * Load and instantiate the WASM module.
 * @param {string|URL|ArrayBuffer} source - Path to .wasm file or ArrayBuffer
 * @returns {Promise<Object>} Resolved exports object
 */
async function loadModule(source) {
  let bytes;
  if (source instanceof ArrayBuffer || (typeof Buffer !== 'undefined' && source instanceof Buffer)) {
    bytes = source;
  } else {
    const response = await fetch(source);
    bytes = await response.arrayBuffer();
  }

  _memory = new WebAssembly.Memory({ initial: 4, maximum: 4096 });

  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      __grow_memory: (pages) => {
        if (pages > 0) {
          const result = _memory.grow(pages);
          if (result === -1) return 0;
        }
        // Re-create the view in case the buffer was reallocated
        _heap_u8 = new Uint8Array(_memory.buffer);
        return _memory.buffer.byteLength;
      },
      memory: _memory,
    },
  });

  _exports = instance.exports;
  _heap_u8 = new Uint8Array(_memory.buffer);

  /* Cache function references for speed */
  _f_init      = _exports.wasm_glsl_parse_init;
  _f_parse     = _exports.wasm_glsl_parse_string;
  _f_get_root  = _exports.wasm_glsl_get_root;
  _f_node_code = _exports.wasm_glsl_node_code;
  _f_node_cc   = _exports.wasm_glsl_node_child_count;
  _f_node_child= _exports.wasm_glsl_node_child;
  _f_data_d    = _exports.wasm_glsl_node_data_d;
  _f_data_f    = _exports.wasm_glsl_node_data_f;
  _f_data_i    = _exports.wasm_glsl_node_data_i;
  _f_data_ui   = _exports.wasm_glsl_node_data_ui;
  _f_data_b    = _exports.wasm_glsl_node_data_b;
  _f_data_str  = _exports.wasm_glsl_node_data_str;
  _f_free_ctx  = _exports.wasm_glsl_parse_free;
  _f_malloc    = _exports.wasm_malloc;
  _f_free      = _exports.wasm_free;

  return _exports;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Allocate a null-terminated string in WASM linear memory.
 * @param {string} str
 * @returns {{ptr: number, len: number}}
 */
function _allocString(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const len = bytes.length;
  const ptr = _f_malloc(len + 1);
  if (!ptr) throw new Error('wasm_malloc failed');
  const view = new Uint8Array(_memory.buffer, ptr, len + 1);
  view.set(bytes);
  view[len] = 0;
  return { ptr, len };
}

/**
 * Read a null-terminated string from WASM memory.
 * @param {number} ptr
 * @returns {string|null}
 */
function _readString(ptr) {
  if (!ptr || ptr < 0 || ptr >= _heap_u8.length) return null;
  const bytes = [];
  let i = ptr;
  // Safety limit: cap at 4096 bytes to prevent walking through garbage memory
  const limit = Math.min(ptr + 4096, _heap_u8.length);
  while (i < limit && _heap_u8[i] !== 0) {
    bytes.push(_heap_u8[i]);
    i++;
  }
  if (i >= limit) return null; // hit the limit without finding null terminator
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Recursively walk the AST and return a JavaScript object tree.
 * @param {number} nodePtr
 * @returns {Object|null}
 */
function readAstNode(nodePtr) {
  if (!nodePtr) return null;

  const code = _f_node_code(nodePtr);
  const childCount = _f_node_cc(nodePtr);

  const node = {
    code,
    codeName: TOKEN_NAMES[code] || `TOKEN_${code}`,
    childCount,
    children: [],
  };

  /* Read data union fields */
  const data = {};
  data.d  = _f_data_d(nodePtr);
  data.f  = _f_data_f(nodePtr);
  data.i  = _f_data_i(nodePtr);
  data.ui = _f_data_ui(nodePtr);
  data.b  = _f_data_b(nodePtr);

  const strPtr = _f_data_str(nodePtr);
  if (strPtr) {
    data.str = _readString(strPtr);
  }
  node.data = data;

  /* Read children */
  for (let i = 0; i < childCount; i++) {
    const childPtr = _f_node_child(nodePtr, i);
    node.children.push(readAstNode(childPtr));
  }

  return node;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Parse GLSL source code synchronously.  The module must be loaded
 * first (via loadModule or init).
 * @param {string} source - GLSL source code
 * @returns {Object|null} AST root node, or null on error
 */
function parseSync(source) {
  if (!_exports)
    throw new Error('WASM module not loaded. Call loadModule() first.');

  const ctx = _f_init();
  if (!ctx) throw new Error('Failed to initialize parser context');

  const { ptr: srcPtr, len: srcLen } = _allocString(source);
  const err = _f_parse(ctx, srcPtr, srcLen);
  _f_free(srcPtr);

  let ast = null;
  if (!err) {
    const root = _f_get_root(ctx);
    ast = readAstNode(root);
  }

  _f_free_ctx(ctx);
  return ast;
}

/**
 * Async version — loads the module first if not already loaded.
 * @param {string} source - GLSL source code
 * @param {string|URL} [wasmPath] - Path to WASM file (auto-detected if omitted)
 * @returns {Promise<Object|null>}
 */
async function parse(source, wasmPath) {
  if (!_exports) {
    const path = wasmPath || (typeof import.meta !== 'undefined'
      ? new URL('glsl-parser.wasm', import.meta.url)
      : './glsl-parser.wasm');
    await loadModule(path);
  }
  return parseSync(source);
}

/**
 * Initialize the module (async).  Call this before parseSync().
 * @param {string|URL|ArrayBuffer} source
 * @returns {Promise<void>}
 */
async function init(source) {
  if (!_exports) {
    await loadModule(source);
  }
}

/* ------------------------------------------------------------------ */
/*  Browser global (for <script> tag usage)                            */
/* ------------------------------------------------------------------ */
if (typeof window !== 'undefined') {
  window.GlslParserWasm = { loadModule, parse, parseSync, init, readAstNode };
}

/* ES module exports */
export { loadModule, parse, parseSync, init, readAstNode };
