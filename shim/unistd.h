#ifndef SHIM_UNISTD_H
#define SHIM_UNISTD_H

/* isatty — stub (used in yy_create_buffer to detect interactive input).
   Always returns 0 (not a tty) in WASM. */
int isatty(int fd);

#endif /* SHIM_UNISTD_H */
