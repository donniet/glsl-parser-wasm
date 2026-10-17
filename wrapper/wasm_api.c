/*
 * wasm_api.c — exported functions for JavaScript
 *
 * Bridges between JS i32 pointers and the C library's actual pointers.
 */

#include "wasm_api.h"
#include "glsl_parser.h"
#include "minlib.h"

/* ------------------------------------------------------------------ */
/*  Context management                                                 */
/* ------------------------------------------------------------------ */

int wasm_glsl_parse_init(void)
{
    struct glsl_parse_context *ctx =
        (struct glsl_parse_context *)malloc(sizeof(*ctx));
    if (!ctx)
        return 0;
    glsl_parse_context_init(ctx);
    return (int)(uintptr_t)ctx;
}

void wasm_glsl_parse_free(int ctx)
{
    if (!ctx)
        return;
    struct glsl_parse_context *c = (struct glsl_parse_context *)(uintptr_t)ctx;
    glsl_parse_context_destroy(c);
    free(c);
}

/* ------------------------------------------------------------------ */
/*  Parsing                                                            */
/* ------------------------------------------------------------------ */

int wasm_glsl_parse_string(int ctx, const char *src, int src_len)
{
    if (!ctx || !src)
        return 1;
    struct glsl_parse_context *c = (struct glsl_parse_context *)(uintptr_t)ctx;

    /* glsl_parse_string expects a null-terminated string.
       We create a temporary null-terminated copy. */
    char *buf = (char *)malloc((size_t)src_len + 1);
    if (!buf)
        return 1;

    /* Manual copy (avoid pulling in more string.h deps) */
    for (int i = 0; i < src_len; i++)
        buf[i] = src[i];
    buf[src_len] = '\0';

    int error = glsl_parse_string(c, buf) ? 1 : 0;
    free(buf);
    return error;
}

int wasm_glsl_get_root(int ctx)
{
    if (!ctx)
        return 0;
    struct glsl_parse_context *c = (struct glsl_parse_context *)(uintptr_t)ctx;
    return (int)(uintptr_t)c->root;
}

/* ------------------------------------------------------------------ */
/*  AST node accessors                                                 */
/* ------------------------------------------------------------------ */

int wasm_glsl_node_code(int node)
{
    if (!node)
        return 0;
    struct glsl_node *n = (struct glsl_node *)(uintptr_t)node;
    return n->code;
}

int wasm_glsl_node_child_count(int node)
{
    if (!node)
        return 0;
    struct glsl_node *n = (struct glsl_node *)(uintptr_t)node;
    return n->child_count;
}

int wasm_glsl_node_child(int node, int index)
{
    if (!node)
        return 0;
    struct glsl_node *n = (struct glsl_node *)(uintptr_t)node;
    if ((unsigned)index >= (unsigned)n->child_count)
        return 0;
    return (int)(uintptr_t)n->children[index];
}

double wasm_glsl_node_data_d(int node)
{
    if (!node)
        return 0.0;
    struct glsl_node *n = (struct glsl_node *)(uintptr_t)node;
    return n->data.d;
}

float wasm_glsl_node_data_f(int node)
{
    if (!node)
        return 0.0f;
    struct glsl_node *n = (struct glsl_node *)(uintptr_t)node;
    return n->data.f;
}

int wasm_glsl_node_data_i(int node)
{
    if (!node)
        return 0;
    struct glsl_node *n = (struct glsl_node *)(uintptr_t)node;
    return n->data.i;
}

int wasm_glsl_node_data_ui(int node)
{
    if (!node)
        return 0;
    struct glsl_node *n = (struct glsl_node *)(uintptr_t)node;
    return (int)n->data.ui;
}

int wasm_glsl_node_data_b(int node)
{
    if (!node)
        return 0;
    struct glsl_node *n = (struct glsl_node *)(uintptr_t)node;
    return n->data.b ? 1 : 0;
}

int wasm_glsl_node_data_str(int node)
{
    if (!node)
        return 0;
    struct glsl_node *n = (struct glsl_node *)(uintptr_t)node;
    return (int)(uintptr_t)n->data.str;
}

/* ------------------------------------------------------------------ */
/*  Memory helpers for JS                                              */
/* ------------------------------------------------------------------ */

int wasm_malloc(int size)
{
    void *p = malloc((size_t)size);
    return (int)(uintptr_t)p;
}

void wasm_free(int ptr)
{
    free((void *)(uintptr_t)ptr);
}
