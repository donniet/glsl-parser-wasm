#ifndef SHIM_ASSERT_H
#define SHIM_ASSERT_H

#ifdef NDEBUG
#define assert(expr) ((void)0)
#else
#define assert(expr) ((void)0)  /* always no-op in WASM target */
#endif

#endif /* SHIM_ASSERT_H */
