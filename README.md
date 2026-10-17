# GLSL Parser WASM

Minimal WebAssembly build of the [glsl-parser](https://github.com/nnesse/glsl-parser) C/Bison/Flex library, with **zero external dependencies** beyond Clang/LLVM.

No Emscripten. No sysroot. No libc. Just the parser, a ~300-line minimal C library, and a thin JS wrapper.

## Build

```bash
git clone --recursive <repo-url> && cd glsl-parser-wasm
make
```

Requires: `clang` (with wasm32 target), `wasm-ld`, `flex`, `bison`.

The parser sources are bundled as a git submodule (`glsl-parser/`).  Override
with `GLSL_SRC=../glsl-parser make` to use a sibling working copy instead.

Produces: `glsl-parser.wasm` (~85 KB)

## Usage

### JavaScript (ES modules)

```js
import { parse } from './js/glsl-parser.js';

const ast = await parse(`
  #version 450
  void main() { gl_FragColor = vec4(1.0); }
`);
console.log(JSON.stringify(ast, null, 2));
```

### JavaScript (sync, after init)

```js
import { loadModule, parseSync } from './js/glsl-parser.js';

await loadModule('./glsl-parser.wasm');
const ast = parseSync('void main() {}');
```

### Browser

See `test/index.html` for a working demo.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  JavaScript (js/glsl-parser.js)                 │
│  - Allocates strings in WASM memory             │
│  - Calls wasm_glsl_parse_string()               │
│  - Walks AST tree, reads node data              │
├─────────────────────────────────────────────────┤
│  WASM Module (glsl-parser.wasm)                 │
│  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ wrapper/     │  │  glsl-parser/ (submodule) │ │
│  │ wasm_api.c   │  │  glsl.y  (Bison parser)  │ │
│  │ (exports)    │  │  glsl.lex (Flex lexer)   │ │
│  │              │  │  glsl_ast.c (AST utils)   │ │
│  └──────┬───────┘  └──────────┬───────────────┘ │
│         │                     │                 │
│         ▼                     ▼                 │
│  ┌──────────────────────────────────────────┐   │
│  │ libmin/minlib.c                          │   │
│  │ malloc / free / realloc (free-list)      │   │
│  │ strlen / strcpy / memset / memcpy        │   │
│  │ atoi / atof / vsnprintf (minimal)        │   │
│  │ stdio stubs (fprintf, exit, etc.)        │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## Project Structure

```
glsl-parser-wasm/
├── glsl-parser/              # git submodule (nnesse/glsl-parser)
├── Makefile                  # Build system (GLSL_SRC ?= glsl-parser)
├── libmin/
│   ├── minlib.h              # Minimal libc declarations
│   └── minlib.c              # malloc/free/realloc, string, atoi, atof, vsnprintf
├── shim/
│   ├── stdio.h               # FILE struct, stdio stubs
│   ├── stdlib.h              # Delegates to minlib
│   ├── string.h              # Delegates to minlib
│   ├── stdint.h              # Integer types
│   ├── stddef.h              # NULL, size_t, offsetof
│   ├── stdbool.h             # bool/true/false
│   ├── stdarg.h              # va_list builtins
│   ├── assert.h              # NDEBUG no-op
│   ├── math.h                # Empty (included but unused)
│   ├── errno.h               # errno variable + EINTR/EINVAL/ENOMEM
│   ├── inttypes.h            # Empty
│   └── unistd.h              # isatty stub
├── wrapper/
│   ├── wasm_api.h            # WASM export declarations
│   └── wasm_api.c            # Export wrapper functions
├── js/
│   ├── glsl-parser.js        # JS loader + API wrapper
│   └── glsl-parser.d.ts      # TypeScript definitions
└── test/
    ├── index.html            # Browser demo
    └── test.mjs              # Node.js test suite
```

## Design Decisions

- **`glsl_parse_string` only** — avoids FILE*/stdio entirely; JS passes strings directly into WASM memory
- **Arena allocator preserved** — the parser's bump-pointer arena means we only need malloc/free for 1MB chunks, not per-node
- **Pointers as i32** — all WASM exports use `int` for pointers; JS manages a separate allocation region
- **`-DNDEBUG`** — eliminates assert dependency
- **stdio stubs** — fprintf/exit/fread/etc. are empty stubs (dead code in our path)
- **`--import-memory`** — JS controls memory allocation, allowing controlled growth

## Stdlib Functions Implemented

| Function | Lines | Complexity |
|----------|-------|------------|
| `malloc` / `free` / `realloc` | ~100 | Free-list with coalescing + WASM memory.grow |
| `strlen` / `strcpy` / `strdup` / `memset` / `memcpy` | ~30 | Byte-by-byte loops |
| `atoi` | ~15 | Sign + digit parsing |
| `atof` | ~50 | Integer + fraction + exponent (e/E) |
| `vsnprintf` | ~80 | %s, %d, %u, %f, %c, %% |
| `fprintf` / `printf` / `exit` / `fwrite` / `fread` / `getc` / `ferror` / `clearerr` / `fileno` / `isatty` | ~30 | Empty stubs |

Total: **~300 lines** of C code for the entire minimal library.
