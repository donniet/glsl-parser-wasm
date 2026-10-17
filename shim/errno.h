#ifndef SHIM_ERRNO_H
#define SHIM_ERRNO_H

/* Error numbers — flex-generated code assigns these to errno.
   We provide a thread-local-like global and the common values. */
#define EINTR  4
#define EINVAL 22
#define ENOMEM 12

/* errno is a mutable int that flex writes to.  We provide a global. */
extern int errno;

#endif /* SHIM_ERRNO_H */
