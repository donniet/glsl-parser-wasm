#ifndef SHIM_STDIO_H
#define SHIM_STDIO_H

#include "stddef.h"
#include "stdarg.h"

/* ------------------------------------------------------------------ */
/*  Minimal FILE struct — flex-generated code uses it as a type.      */
/*  We never actually do file I/O (glsl_parse_string uses scan_buffer).*/
/* ------------------------------------------------------------------ */

struct FILE {
    int _dummy;
};
typedef struct FILE FILE;

/* Stdio constants */
#define EOF (-1)

/* Standard streams — stubs, never used in our code path */
extern FILE *stdin;
extern FILE *stdout;
extern FILE *stderr;

/* FILE I/O functions — stubs.  The flex-generated code references these
   in the YY_INPUT macro and ECHO, but we use glsl__scan_buffer so none
   of these are ever called at runtime. */
unsigned long fwrite(const void *ptr, unsigned long size,
                     unsigned long nmemb, FILE *stream);
unsigned long fread(void *ptr, unsigned long size,
                    unsigned long nmemb, FILE *stream);
int           getc(FILE *stream);
int           ferror(FILE *stream);
void          clearerr(FILE *stream);

/* Format I/O — stubs */
int fprintf(FILE *stream, const char *format, ...);
int printf(const char *format, ...);
int vsnprintf(char *buf, size_t size, const char *format, va_list ap);

/* File descriptor — stub (used in yy_create_buffer's isatty check) */
int fileno(FILE *stream);

/* Process control — stub */
void exit(int code);

#endif /* SHIM_STDIO_H */
