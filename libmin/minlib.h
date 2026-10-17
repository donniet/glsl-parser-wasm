#ifndef MINLIB_H
#define MINLIB_H

#include "stddef.h"
#include "stdarg.h"

/* ------------------------------------------------------------------ */
/*  Memory allocator                                                  */
/* ------------------------------------------------------------------ */

/* Grow WASM linear memory by the given number of 64 KB pages.
   Returns the new total memory size in bytes, or 0 on failure.
   If pages is 0, just returns the current memory size.
   This is implemented in JS and imported at link time. */
extern void *__grow_memory(int pages);

/* Allocator API */
void  *malloc(size_t size);
void   free(void *ptr);
void  *realloc(void *ptr, size_t size);

/* ------------------------------------------------------------------ */
/*  String functions                                                  */
/* ------------------------------------------------------------------ */

size_t strlen(const char *s);
char  *strcpy(char *dest, const char *src);
char  *strdup(const char *s);
void  *memset(void *ptr, int value, size_t num);
void  *memcpy(void *dest, const void *src, size_t num);

/* ------------------------------------------------------------------ */
/*  Number conversion                                                 */
/* ------------------------------------------------------------------ */

int    atoi(const char *nptr);
double atof(const char *nptr);

/* ------------------------------------------------------------------ */
/*  Format I/O                                                        */
/* ------------------------------------------------------------------ */

int    vsnprintf(char *buf, size_t size, const char *format, va_list ap);

#endif /* MINLIB_H */
