/**
 * glsl-ast-utils — higher-level GLSL AST utilities
 *
 * Wraps the low-level WASM parser with helpers for extracting function
 * signatures, parameter types, and uniform declarations.
 *
 * Usage:
 *   const { parseGLSL, extractFunctions, extractUniforms } = await import('./glsl-ast-utils.js');
 *   const ast = await parseGLSL(source);
 *   const functions = extractFunctions(ast);
 */

import { loadModule, parseSync } from './glsl-parser.js';

/* ------------------------------------------------------------------ */
/*  Eager WASM initialization                                         */
/* ------------------------------------------------------------------ */

const _wasmPath = new URL('glsl-parser.wasm', import.meta.url);
const _wasmReady = loadModule(_wasmPath);

/**
 * Ensure the WASM module is loaded. Awaits the eager load if still in progress.
 */
async function ensureLoaded() {
  await _wasmReady;
}

/* ------------------------------------------------------------------ */
/*  Token code → GLSL type name mapping                               */
/* ------------------------------------------------------------------ */

const TYPE_CODE_MAP = {
  // Scalar types
  259: 'bool',     // BOOL
  260: 'float',    // FLOAT
  261: 'int',      // INT
  262: 'uint',     // UINT
  264: 'double',   // DOUBLE
  409: 'void',     // VOID

  // Bool vectors
  277: 'bvec2',    // BVEC2
  278: 'bvec3',    // BVEC3
  279: 'bvec4',    // BVEC4

  // Int vectors
  280: 'ivec2',    // IVEC2
  281: 'ivec3',    // IVEC3
  282: 'ivec4',    // IVEC4

  // Unsigned int vectors
  283: 'uvec2',    // UVEC2
  284: 'uvec3',    // UVEC3
  285: 'uvec4',    // UVEC4

  // Float vectors
  286: 'vec2',     // VEC2
  287: 'vec3',     // VEC3
  288: 'vec4',     // VEC4

  // Double vectors
  306: 'dvec2',    // DVEC2
  307: 'dvec3',    // DVEC3
  308: 'dvec4',    // DVEC4

  // Matrices
  289: 'mat2',     // MAT2
  290: 'mat3',     // MAT3
  291: 'mat4',     // MAT4
  316: 'mat2x2',   // MAT2X2
  317: 'mat2x3',   // MAT2X3
  318: 'mat2x4',   // MAT2X4
  319: 'mat3x2',   // MAT3X2
  320: 'mat3x3',   // MAT3X3
  321: 'mat3x4',   // MAT3X4
  322: 'mat4x2',   // MAT4X2
  323: 'mat4x3',   // MAT4X3
  324: 'mat4x4',   // MAT4X4

  // Sampler types
  335: 'sampler1D',
  336: 'sampler2D',
  337: 'sampler3D',
  338: 'samplerCube',
  340: 'sampler2DShadow',
  343: 'sampler2DArray',
  347: 'isampler2D',
  353: 'usampler2D',
  358: 'sampler2DRect',
  369: 'sampler2DMS',
};

/**
 * Map a parser token code to a GLSL type name string.
 */
export function typeCodeToName(code) {
  return TYPE_CODE_MAP[code] || `unknown_type_${code}`;
}

/* ------------------------------------------------------------------ */
/*  AST node type codes (from glsl.parser.h)                           */
/* ------------------------------------------------------------------ */

export const NODE = {
  TRANSLATION_UNIT:        478,
  FUNCTION_DEFINITION:     485,
  FUNCTION_DECLARATION:    511,
  FUNCTION_HEADER:         510,
  FUNCTION_PARAMETER_LIST: 512,
  PARAMETER_DECLARATION:   513,
  PARAMETER_DECLARATOR:    514,
  FULLY_SPECIFIED_TYPE:    494,
  TYPE_SPECIFIER:          479,
  TYPE_QUALIFIER_LIST:     481,
  IDENTIFIER:              411,
  DECLARATION:             486,
  SINGLE_DECLARATION:      495,
  SINGLE_INIT_DECLARATION: 496,
  INIT_DECLARATOR_LIST:    493,
  INIT_DECLARATOR:         497,
  BLOCK_DECLARATION:       490,

  // Storage qualifiers
  UNIFORM:  296,
  BUFFER:   297,
  IN:       293,
  OUT:      294,
  INOUT:    295,
};

/* ------------------------------------------------------------------ */
/*  AST traversal helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Find a child node by its code type.
 */
function findChild(node, code) {
  if (!node || !node.children) return null;
  return node.children.find(c => c && c.code === code) || null;
}

/**
 * Get the type specifier from a FULLY_SPECIFIED_TYPE node.
 */
function getTypeSpecifier(fullySpecType) {
  if (!fullySpecType) return null;
  for (const child of fullySpecType.children) {
    if (child.code === NODE.TYPE_SPECIFIER) return child;
  }
  return fullySpecType.children[fullySpecType.children.length - 1] || null;
}

/**
 * Extract the base type code from a TYPE_SPECIFIER node.
 */
function getBaseTypeCode(typeSpec) {
  if (!typeSpec) return 0;
  if (typeSpec.children && typeSpec.children.length > 0) {
    const first = typeSpec.children[0];
    if (TYPE_CODE_MAP[first.code] !== undefined) {
      return first.code;
    }
    if (first.code === NODE.IDENTIFIER) {
      return first.code;
    }
  }
  return typeSpec.code;
}

/**
 * Extract type name from a type specifier node.
 */
function extractTypeName(typeSpecNode) {
  if (!typeSpecNode) return 'unknown';
  const code = getBaseTypeCode(typeSpecNode);
  const name = typeCodeToName(code);
  if (name !== `unknown_type_${code}`) return name;
  if (typeSpecNode.children && typeSpecNode.children[0]) {
    const first = typeSpecNode.children[0];
    if (first.code === NODE.IDENTIFIER && first.data.str) {
      return first.data.str;
    }
  }
  return name;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse GLSL source code and return the AST.
 * @param {string} source - GLSL source code
 * @returns {Promise<Object|null>} AST root node, or null on error
 */
export async function parseGLSL(source) {
  await ensureLoaded();
  try {
    return parseSync(source);
  } catch (e) {
    console.error('GLSL parse error:', e);
    return null;
  }
}

/**
 * Extract all function definitions from a parsed AST.
 * @param {Object} ast - Parsed AST root node
 * @returns {Array<{name: string, returnType: string, params: Array<{name: string, type: string}>}>}
 */
export function extractFunctions(ast) {
  if (!ast) return [];

  const functions = [];
  for (const child of ast.children || []) {
    if (child.code === NODE.FUNCTION_DEFINITION) {
      const fn = extractFunctionSignature(child);
      if (fn) functions.push(fn);
    }
  }
  return functions;
}

/**
 * Extract a single function's signature from a FUNCTION_DEFINITION node.
 */
function extractFunctionSignature(funcDefNode) {
  const funcDecl = findChild(funcDefNode, NODE.FUNCTION_DECLARATION);
  if (!funcDecl) return null;

  const funcHeader = findChild(funcDecl, NODE.FUNCTION_HEADER);
  const paramList = findChild(funcDecl, NODE.FUNCTION_PARAMETER_LIST);

  if (!funcHeader || funcHeader.children.length < 2) return null;

  const returnTypeSpec = funcHeader.children.find(c => c.code === NODE.FULLY_SPECIFIED_TYPE);
  const nameNode = funcHeader.children.find(c => c.code === NODE.IDENTIFIER);

  const returnType = returnTypeSpec ? extractTypeName(getTypeSpecifier(returnTypeSpec)) : 'unknown';
  const name = nameNode ? (nameNode.data.str || 'unknown') : 'unknown';

  const params = [];
  if (paramList) {
    for (const paramDecl of paramList.children || []) {
      if (paramDecl.code === NODE.PARAMETER_DECLARATION) {
        const param = extractParameter(paramDecl);
        if (param) params.push(param);
      }
    }
  }

  return { name, returnType, params };
}

/**
 * Extract a single parameter from a PARAMETER_DECLARATION node.
 */
function extractParameter(paramDeclNode) {
  const paramDeclarator = findChild(paramDeclNode, NODE.PARAMETER_DECLARATOR);
  if (!paramDeclarator || paramDeclarator.children.length < 2) return null;

  let typeSpec = null;
  let ident = null;

  for (const child of paramDeclarator.children) {
    if (child.code === NODE.TYPE_SPECIFIER) typeSpec = child;
    if (child.code === NODE.IDENTIFIER) ident = child;
  }

  if (!ident) return null;

  const typeName = typeSpec ? extractTypeName(typeSpec) : 'unknown';
  const paramName = ident.data.str || 'unknown';

  return { name: paramName, type: typeName };
}

/**
 * Extract uniform declarations from a parsed AST.
 * @param {Object} ast - Parsed AST root node
 * @returns {Array<{name: string, type: string}>}
 */
export function extractUniforms(ast) {
  if (!ast) return [];

  const uniforms = [];
  for (const child of ast.children || []) {
    if (child.code === NODE.DECLARATION) {
      const found = extractUniformsFromDeclaration(child);
      uniforms.push(...found);
    }
  }
  return uniforms;
}

function extractUniformsFromDeclaration(declNode) {
  const uniforms = [];

  const qualifierList = findChild(declNode, NODE.TYPE_QUALIFIER_LIST);
  if (!qualifierList) return uniforms;

  let hasUniform = false;
  for (const child of qualifierList.children || []) {
    if (child.code === NODE.UNIFORM) {
      hasUniform = true;
      break;
    }
  }
  if (!hasUniform) return uniforms;

  const singleDecl = findChild(declNode, NODE.SINGLE_DECLARATION);
  if (!singleDecl) return uniforms;

  const initList = findChild(singleDecl, NODE.INIT_DECLARATOR_LIST);

  const typeSpec = findChild(singleDecl, NODE.TYPE_SPECIFIER);
  const typeName = typeSpec ? extractTypeName(typeSpec) : 'unknown';

  if (initList) {
    for (const initDeclItem of initList.children || []) {
      if (initDeclItem.code === NODE.INIT_DECLARATOR) {
        const declarator = findChild(initDeclItem, NODE.PARAMETER_DECLARATOR);
        if (declarator) {
          const ident = findChild(declarator, NODE.IDENTIFIER);
          if (ident && ident.data.str) {
            uniforms.push({ name: ident.data.str, type: typeName });
          }
        }
      }
    }
  }

  return uniforms;
}
