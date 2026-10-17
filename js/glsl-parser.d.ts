// TypeScript definitions for glsl-parser-wasm

export interface GlslParserModule {
  instantiate(buffer: ArrayBuffer): Promise<{ exports: GlslParserExports }>;
}

export interface GlslParserExports {
  wasm_glsl_parse_init(): number;
  wasm_glsl_parse_string(ctx: number, src: number, srcLen: number): number;
  wasm_glsl_get_root(ctx: number): number;
  wasm_glsl_node_code(node: number): number;
  wasm_glsl_node_child_count(node: number): number;
  wasm_glsl_node_child(node: number, index: number): number;
  wasm_glsl_node_data_d(node: number): number;
  wasm_glsl_node_data_f(node: number): number;
  wasm_glsl_node_data_i(node: number): number;
  wasm_glsl_node_data_ui(node: number): number;
  wasm_glsl_node_data_b(node: number): number;
  wasm_glsl_node_data_str(node: number): number;
  wasm_glsl_parse_free(ctx: number): void;
  wasm_malloc(size: number): number;
  wasm_free(ptr: number): void;
  memory: WebAssembly.Memory;
}

export interface AstNode {
  code: number;
  childCount: number;
  children: AstNode[];
  data: { d?: number; f?: number; i?: number; ui?: number; b?: number; str?: string };
}

export function parse(source: string): AstNode | null;
export function parseSync(source: string): AstNode | null;
