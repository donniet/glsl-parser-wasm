#ifndef SHIM_STDLIB_H
#define SHIM_STDLIB_H

#include "stddef.h"

/* Memory allocation — implemented in libmin/minlib.c */
void  *malloc(size_t size);
void   free(void *ptr);
void  *realloc(void *ptr, size_t size);

/* String helpers — implemented in libmin/minlib.c */
char  *strdup(const char *s);

/* Number conversion — implemented in libmin/minlib.c */
int    atoi(const char *nptr);
double atof(const char *nptr);

/* Process control — stubbed */
void   exit(int code);

#endif /* SHIM_STDLIB_H */
