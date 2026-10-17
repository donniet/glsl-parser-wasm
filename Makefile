#
# glsl-parser-wasm — minimal WASM build (no Emscripten)
#
# Dependencies: clang (with wasm32 target), wasm-ld, flex, bison
#

GLSL_SRC   = ../glsl-parser
CC         = clang
WASM_LD    = wasm-ld
FLEX       = flex
BISON      = bison

CFLAGS     = --target=wasm32-freestanding -nostdlib -DNDEBUG -O2 \
             -Ishim -Ilibmin -Iwrapper -I$(GLSL_SRC)

# Generated files
LEX_SRC    = $(GLSL_SRC)/glsl.lex
LEX_OBJ    = glsl.lexer.o
LEX_C      = glsl.lexer.c
LEX_H      = glsl.lexer.h

PARSER_SRC = $(GLSL_SRC)/glsl.y
PARSER_OBJ = glsl.parser.o
PARSER_C   = glsl.parser.c
PARSER_H   = glsl.parser.h

# Object files
OBJS       = $(PARSER_OBJ) $(LEX_OBJ) glsl_ast.o wrapper/wasm_api.o libmin/minlib.o

# Output
WASM       = glsl-parser.wasm

.PHONY: all clean

all: $(WASM) js/glsl-parser.d.ts

# ------------------------------------------------------------------
# Generate lexer and parser from flex/bison sources
# ------------------------------------------------------------------

$(LEX_C) $(LEX_H): $(LEX_SRC)
	$(FLEX) --header-file=$(LEX_H) -o $(LEX_C) $<

$(PARSER_C) $(PARSER_H): $(PARSER_SRC)
	$(BISON) --defines=$(PARSER_H) $< -o $(PARSER_C)

# ------------------------------------------------------------------
# Compile source files to object files
# ------------------------------------------------------------------

$(PARSER_OBJ): $(PARSER_C) $(PARSER_H) $(LEX_H) $(GLSL_SRC)/glsl_parser.h
	$(CC) $(CFLAGS) -c $< -o $@

$(LEX_OBJ): $(LEX_C) $(LEX_H) $(PARSER_H) $(GLSL_SRC)/glsl_parser.h
	$(CC) $(CFLAGS) -c $< -o $@

glsl_ast.o: $(GLSL_SRC)/glsl_ast.c $(GLSL_SRC)/glsl_ast.h $(GLSL_SRC)/glsl_parser.h
	$(CC) $(CFLAGS) -c $< -o $@

wrapper/wasm_api.o: wrapper/wasm_api.c wrapper/wasm_api.h $(GLSL_SRC)/glsl_parser.h
	$(CC) $(CFLAGS) -c $< -o $@

libmin/minlib.o: libmin/minlib.c libmin/minlib.h
	$(CC) $(CFLAGS) -c $< -o $@

# ------------------------------------------------------------------
# Link into WASM
# ------------------------------------------------------------------

$(WASM): $(OBJS)
	$(WASM_LD) --no-entry -o $@ $^ \
		--export=wasm_glsl_parse_init \
		--export=wasm_glsl_parse_string \
		--export=wasm_glsl_get_root \
		--export=wasm_glsl_node_code \
		--export=wasm_glsl_node_child_count \
		--export=wasm_glsl_node_child \
		--export=wasm_glsl_node_data_d \
		--export=wasm_glsl_node_data_f \
		--export=wasm_glsl_node_data_i \
		--export=wasm_glsl_node_data_ui \
		--export=wasm_glsl_node_data_b \
		--export=wasm_glsl_node_data_str \
		--export=wasm_glsl_parse_free \
		--export=wasm_malloc \
		--export=wasm_free \
		--export=__heap_base \
		--import-memory \
		--allow-undefined

# ------------------------------------------------------------------
# TypeScript definitions (generated from wasm_api.h)
# ------------------------------------------------------------------

js/glsl-parser.d.ts: wrapper/wasm_api.h
	@echo '// TypeScript definitions for glsl-parser-wasm' > $@
	@echo '' >> $@
	@echo 'export interface GlslParserModule {' >> $@
	@echo '  instantiate(buffer: ArrayBuffer): Promise<{ exports: GlslParserExports }>;' >> $@
	@echo '}' >> $@
	@echo '' >> $@
	@echo 'export interface GlslParserExports {' >> $@
	@echo '  wasm_glsl_parse_init(): number;' >> $@
	@echo '  wasm_glsl_parse_string(ctx: number, src: number, srcLen: number): number;' >> $@
	@echo '  wasm_glsl_get_root(ctx: number): number;' >> $@
	@echo '  wasm_glsl_node_code(node: number): number;' >> $@
	@echo '  wasm_glsl_node_child_count(node: number): number;' >> $@
	@echo '  wasm_glsl_node_child(node: number, index: number): number;' >> $@
	@echo '  wasm_glsl_node_data_d(node: number): number;' >> $@
	@echo '  wasm_glsl_node_data_f(node: number): number;' >> $@
	@echo '  wasm_glsl_node_data_i(node: number): number;' >> $@
	@echo '  wasm_glsl_node_data_ui(node: number): number;' >> $@
	@echo '  wasm_glsl_node_data_b(node: number): number;' >> $@
	@echo '  wasm_glsl_node_data_str(node: number): number;' >> $@
	@echo '  wasm_glsl_parse_free(ctx: number): void;' >> $@
	@echo '  wasm_malloc(size: number): number;' >> $@
	@echo '  wasm_free(ptr: number): void;' >> $@
	@echo '  memory: WebAssembly.Memory;' >> $@
	@echo '}' >> $@
	@echo '' >> $@
	@echo 'export interface AstNode {' >> $@
	@echo '  code: number;' >> $@
	@echo '  childCount: number;' >> $@
	@echo '  children: AstNode[];' >> $@
	@echo '  data: { d?: number; f?: number; i?: number; ui?: number; b?: number; str?: string };' >> $@
	@echo '}' >> $@
	@echo '' >> $@
	@echo 'export function parse(source: string): AstNode | null;' >> $@
	@echo 'export function parseSync(source: string): AstNode | null;' >> $@

clean:
	rm -f $(WASM) $(OBJS) $(LEX_C) $(LEX_H) $(PARSER_C) $(PARSER_H)
	rm -f js/glsl-parser.d.ts
