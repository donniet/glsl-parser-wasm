#ifndef SHIM_STDDEF_H
#define SHIM_STDDEF_H

#ifndef _Ptrdiff_T
#define _Ptrdiff_T
typedef long ptrdiff_t;
#endif

#ifndef _Size_T
#define _Size_T
typedef unsigned long size_t;
#endif

#ifndef NULL
#define NULL ((void *)0)
#endif

#define offsetof(type, member) __builtin_offsetof(type, member)

#endif /* SHIM_STDDEF_H */
