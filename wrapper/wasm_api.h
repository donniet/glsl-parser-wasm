#ifndef WASM_API_H
#define WASM_API_H

/*
 * WASM API — exported functions for JavaScript to call.
 *
 * All pointers are passed as i32 (32-bit integers).
 * JS is responsible for allocating memory in WASM linear memory
 * for input strings and for reading back AST data.
 */

/*
 * Initialize a new parse context.
 * Returns: pointer to glsl_parse_context (as i32), 0 on failure.
 */
int wasm_glsl_parse_init(void);

/*
 * Parse GLSL source code from a string in WASM linear memory.
 *   ctx     — pointer returned by wasm_glsl_parse_init
 *   src     — pointer to null-terminated GLSL source string
 *   src_len — length of the source string (not including null)
 * Returns: 0 on success, 1 on parse error.
 */
int wasm_glsl_parse_string(int ctx, const char *src, int src_len);

/*
 * Get the root AST node pointer.
 * Returns: pointer to glsl_node (as i32), 0 if no root.
 */
int wasm_glsl_get_root(int ctx);

/*
 * Read AST node fields.  node is a pointer to a glsl_node (as i32).
 */
int  wasm_glsl_node_code(int node);
int  wasm_glsl_node_child_count(int node);
int  wasm_glsl_node_child(int node, int index);

/* Data union accessors — read the appropriate field based on node code. */
double wasm_glsl_node_data_d(int node);
float  wasm_glsl_node_data_f(int node);
int    wasm_glsl_node_data_i(int node);
int    wasm_glsl_node_data_ui(int node);
int    wasm_glsl_node_data_b(int node);
int    wasm_glsl_node_data_str(int node);  /* returns pointer to string (i32) */

/*
 * Free the parse context and all arena memory.
 */
void wasm_glsl_parse_free(int ctx);

/*
 * Allocate memory in WASM linear memory (for JS to use when passing
 * strings or storing data).  This uses the same allocator as the parser.
 * Returns: pointer (as i32), 0 on failure.
 */
int wasm_malloc(int size);

/*
 * Free memory allocated by wasm_malloc.
 */
void wasm_free(int ptr);

#endif /* WASM_API_H */
