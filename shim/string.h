#ifndef SHIM_STRING_H
#define SHIM_STRING_H

#include "stddef.h"

/* String operations — implemented in libmin/minlib.c */
size_t strlen(const char *s);
char  *strcpy(char *dest, const char *src);
void  *memset(void *ptr, int value, size_t num);
void  *memcpy(void *dest, const void *src, size_t num);

#endif /* SHIM_STRING_H */
