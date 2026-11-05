/*
 * minlib.c — minimal libc for WASM target
 *
 * Implements: malloc, free, realloc, strlen, strcpy, strdup, memset,
 *             atoi, atof, fprintf, exit, stderr
 *
 * Memory allocator: free-list on top of WASM linear memory growth.
 * Block layout: [header: size | next_free] [user data...]
 */

#include "minlib.h"
#include "stdint.h"
#include "stdio.h"
#include "stdarg.h"

/* ------------------------------------------------------------------ */
/*  Memory allocator                                                  */
/* ------------------------------------------------------------------ */

/* Import: grow WASM memory by `pages` 64 KB pages.
   Returns the new heap end pointer, or NULL on failure. */
extern void *__grow_memory(int pages);

#define PAGE_SIZE    (64 * 1024)
#define MIN_PAGES    1
#define ALIGN_UP(x, a) (((x) + (a) - 1) & ~((a) - 1))
#define HEADER_SIZE  ALIGN_UP(sizeof(block_header), ALIGNMENT)
#define ALIGNMENT    8

typedef struct block_header {
    size_t        size;        /* payload size (not including header) */
    struct block_header *next; /* next free block (valid when free)   */
} block_header;

/* Heap state */
static block_header *free_list  = NULL;
static uint8_t      *heap_start = NULL;
static uint8_t      *heap_end   = NULL;

/* __heap_base is exported by wasm-ld and marks the start of the heap
   region (after the data segment). */
extern uint8_t __heap_base;

static void alloc_init(void)
{
    if (heap_start)
        return;

    /* Start the heap at __heap_base, not at memory base */
    heap_start = &__heap_base;

    /* Ask for initial pages; __grow_memory returns the new memory size.
       The memory already exists (imported), so we just need to track
       where the heap ends. */
    size_t mem_size = (size_t)__grow_memory(0);
    if (!mem_size)
        for (;;);  /* unreachable — trap */

    heap_end = (uint8_t *)mem_size;

    /* If heap_end is at or before heap_start, grow memory */
    if (heap_end <= heap_start) {
        (void)__grow_memory(MIN_PAGES);
        mem_size = (size_t)__grow_memory(0);
        heap_end = (uint8_t *)mem_size;
    }

    /* Entire initial region is one free block */
    free_list = (block_header *)heap_start;
    free_list->size = (size_t)(heap_end - heap_start - HEADER_SIZE);
    free_list->next = NULL;
}

void *malloc(size_t size)
{
    if (size == 0)
        size = 1;  /* malloc(0) returns a valid minimal pointer */

    alloc_init();

    size = ALIGN_UP(size, ALIGNMENT);

    /* First-fit search through free list */
    block_header *prev = NULL;
    block_header *curr = free_list;

    while (curr) {
        if (curr->size >= size)
            break;
        prev = curr;
        curr = curr->next;
    }

    if (!curr) {
        /* No suitable block — grow memory */
        size_t need = ALIGN_UP(size + HEADER_SIZE, PAGE_SIZE);
        size_t pages = need / PAGE_SIZE;
        if (need % PAGE_SIZE)
            pages++;
        if (pages < 1)
            pages = 1;

        size_t new_size = (size_t)__grow_memory((int)pages);
        if (!new_size)
            for (;;);  /* unreachable — trap */

        /* Add the new region as a free block. It is the highest-address
           region in the heap, so append it at the TAIL to keep the free list
           sorted by address — free() walks the list in address order to find
           the coalescing neighbours, which breaks if the list is unsorted. */
        size_t old_end = (size_t)heap_end;
        heap_end = (uint8_t *)new_size;
        curr = (block_header *)old_end;
        curr->size = (size_t)(heap_end - old_end - HEADER_SIZE);
        curr->next = NULL;
        if (!free_list)
            free_list = curr;
        else {
            block_header *tail = free_list;
            while (tail->next)
                tail = tail->next;
            tail->next = curr;
        }

        /* Re-search */
        prev = NULL;
        curr = free_list;
        while (curr && curr->size < size) {
            prev = curr;
            curr = curr->next;
        }
        if (!curr)
            for (;;);  /* should never happen */
    }

    /* Split block if remainder is large enough for another allocation */
    if (curr->size >= size + HEADER_SIZE + ALIGNMENT) {
        block_header *new_block = (block_header *)((uint8_t *)curr + HEADER_SIZE + size);
        new_block->size = curr->size - size - HEADER_SIZE;
        new_block->next = curr->next;
        curr->size = size;
        if (prev)
            prev->next = new_block;
        else
            free_list = new_block;
    } else {
        /* Use the whole block */
        if (prev)
            prev->next = curr->next;
        else
            free_list = curr->next;
    }

    return (void *)((uint8_t *)curr + HEADER_SIZE);
}

void free(void *ptr)
{
    if (!ptr)
        return;

    alloc_init();

    block_header *block = (block_header *)((uint8_t *)ptr - HEADER_SIZE);

    /* Sanity: block must be within heap */
    if ((uint8_t *)block < heap_start || (uint8_t *)block >= heap_end)
        for (;;);  /* trap */

    /* Insert into free list (sorted by address for coalescing) */
    block_header *prev = NULL;
    block_header *curr = free_list;

    while (curr && curr < block) {
        prev = curr;
        curr = curr->next;
    }

    /* Coalesce with next block if adjacent */
    block_header *next_phys = (block_header *)((uint8_t *)block + HEADER_SIZE + block->size);
    if (curr == next_phys && curr) {
        block->size += HEADER_SIZE + curr->size;
        block->next  = curr->next;
    } else {
        block->next = curr;
    }

    /* Coalesce with previous block if adjacent */
    if (prev) {
        block_header *prev_end = (block_header *)((uint8_t *)prev + HEADER_SIZE + prev->size);
        if (prev_end == block) {
            prev->size += HEADER_SIZE + block->size;
            prev->next  = block->next;
            block       = prev;
        }
    }

    /* Link the block into the list. When it was absorbed into prev above,
       prev already points past it, so only link when it is a distinct node. */
    if (block != prev) {
        if (prev)
            prev->next = block;
        else
            free_list = block;
    }
}

void *realloc(void *ptr, size_t size)
{
    if (!size) {
        free(ptr);
        return NULL;
    }
    if (!ptr)
        return malloc(size);

    block_header *block = (block_header *)((uint8_t *)ptr - HEADER_SIZE);
    size_t old_size = block->size;

    if (size <= old_size)
        return ptr;  /* no growth needed */

    void *new_ptr = malloc(size);
    if (!new_ptr)
        return NULL;

    /* Copy old data */
    uint8_t *d = (uint8_t *)new_ptr;
    uint8_t *s = (uint8_t *)ptr;
    for (size_t i = 0; i < old_size; i++)
        d[i] = s[i];

    free(ptr);
    return new_ptr;
}

/* ------------------------------------------------------------------ */
/*  String functions                                                  */
/* ------------------------------------------------------------------ */

size_t strlen(const char *s)
{
    size_t len = 0;
    while (s[len])
        len++;
    return len;
}

char *strcpy(char *dest, const char *src)
{
    char *d = dest;
    while ((*d++ = *src++))
        ;
    return dest;
}

char *strdup(const char *s)
{
    size_t len = strlen(s);
    char *dup = (char *)malloc(len + 1);
    if (!dup)
        return NULL;
    return strcpy(dup, s);
}

void *memset(void *ptr, int value, size_t num)
{
    uint8_t *p = (uint8_t *)ptr;
    uint8_t v  = (uint8_t)value;
    while (num--) {
        *p++ = v;
    }
    return ptr;
}

void *memcpy(void *dest, const void *src, size_t num)
{
    uint8_t *d = (uint8_t *)dest;
    const uint8_t *s = (const uint8_t *)src;
    while (num--) {
        *d++ = *s++;
    }
    return dest;
}

/* ------------------------------------------------------------------ */
/*  Number conversion                                                 */
/* ------------------------------------------------------------------ */

int atoi(const char *nptr)
{
    int sign = 1;
    int val  = 0;

    /* Skip leading whitespace */
    while (*nptr == ' ' || *nptr == '\t' || *nptr == '\n' ||
           *nptr == '\r' || *nptr == '\f' || *nptr == '\v')
        nptr++;

    /* Handle sign */
    if (*nptr == '-') { sign = -1; nptr++; }
    else if (*nptr == '+') { nptr++; }

    /* Parse digits */
    while (*nptr >= '0' && *nptr <= '9') {
        val = val * 10 + (*nptr - '0');
        nptr++;
    }

    return val * sign;
}

/* pow10 table for exponent handling */
static double pow10_int(int e)
{
    double r = 1.0;
    double p = 10.0;
    int neg = 0;
    if (e < 0) { neg = 1; e = -e; }
    while (e) {
        if (e & 1) r *= p;
        p *= p;
        e >>= 1;
    }
    return neg ? 1.0 / r : r;
}

double atof(const char *nptr)
{
    int sign = 1;
    double val = 0.0;
    int has_decimal = 0;
    int dec_places = 0;

    /* Skip leading whitespace */
    while (*nptr == ' ' || *nptr == '\t' || *nptr == '\n' ||
           *nptr == '\r' || *nptr == '\f' || *nptr == '\v')
        nptr++;

    /* Handle sign */
    if (*nptr == '-') { sign = -1; nptr++; }
    else if (*nptr == '+') { nptr++; }

    /* Parse integer and fractional part */
    while (*nptr) {
        if (*nptr >= '0' && *nptr <= '9') {
            val = val * 10.0 + (*nptr - '0');
            if (has_decimal)
                dec_places++;
            nptr++;
        } else if (*nptr == '.' && !has_decimal) {
            has_decimal = 1;
            nptr++;
        } else {
            break;
        }
    }

    /* Apply decimal point */
    while (dec_places--)
        val /= 10.0;

    /* Handle exponent (e/E) */
    if (*nptr == 'e' || *nptr == 'E') {
        nptr++;
        int exp_sign = 1;
        int exp_val  = 0;

        if (*nptr == '-') { exp_sign = -1; nptr++; }
        else if (*nptr == '+') { nptr++; }

        while (*nptr >= '0' && *nptr <= '9') {
            exp_val = exp_val * 10 + (*nptr - '0');
            nptr++;
        }

        if (exp_sign < 0)
            exp_val = -exp_val;
        val *= pow10_int(exp_val);
    }

    return sign < 0 ? -val : val;
}

/* ------------------------------------------------------------------ */
/*  stdio stubs                                                       */
/* ------------------------------------------------------------------ */

static FILE _stdin_dummy, _stdout_dummy, _stderr_dummy;
FILE *stdin  = &_stdin_dummy;
FILE *stdout = &_stdout_dummy;
FILE *stderr = &_stderr_dummy;

/* Minimal vsnprintf — supports %s, %d, %u, %f, %c, %% and no flags/width/precision.
   Used only by glsl_ast_generate_glsl for regenerating GLSL source. */
int vsnprintf(char *buf, size_t size, const char *format, va_list ap)
{
    int pos = 0;

    while (*format && pos < (int)size - 1) {
        if (*format == '%') {
            format++;
            switch (*format) {
            case 's': {
                const char *s = va_arg(ap, const char *);
                if (!s) s = "(null)";
                while (*s && pos < (int)size - 1)
                    buf[pos++] = *s++;
                break;
            }
            case 'd': {
                int val = va_arg(ap, int);
                char tmp[20];
                int tpos = 0;
                if (val < 0) {
                    buf[pos++] = '-';
                    val = -val;
                }
                if (val == 0) tmp[tpos++] = '0';
                else {
                    int buf2[20]; int bi = 0;
                    while (val) { buf2[bi++] = val % 10; val /= 10; }
                    while (bi) tmp[tpos++] = '0' + buf2[--bi];
                }
                while (tpos && pos < (int)size - 1)
                    buf[pos++] = tmp[--tpos];
                break;
            }
            case 'u': {
                unsigned int val = va_arg(ap, unsigned int);
                char tmp[20];
                int tpos = 0;
                if (val == 0) tmp[tpos++] = '0';
                else {
                    int buf2[20]; int bi = 0;
                    while (val) { buf2[bi++] = val % 10; val /= 10; }
                    while (bi) tmp[tpos++] = '0' + buf2[--bi];
                }
                while (tpos && pos < (int)size - 1)
                    buf[pos++] = tmp[--tpos];
                break;
            }
            case 'f': {
                double val = va_arg(ap, double);
                /* Minimal float formatting: up to 6 decimal places */
                if (val < 0) {
                    buf[pos++] = '-';
                    val = -val;
                }
                /* Integer part */
                unsigned int ival = (unsigned int)val;
                if (ival == 0) buf[pos++] = '0';
                else {
                    char tbuf[20]; int ti = 0;
                    unsigned int tmp = ival;
                    while (tmp) { tbuf[ti++] = '0' + (tmp % 10); tmp /= 10; }
                    while (ti && pos < (int)size - 1) buf[pos++] = tbuf[--ti];
                }
                /* Decimal point + 6 digits */
                if (pos < (int)size - 1) buf[pos++] = '.';
                double frac = val - ival;
                for (int d = 0; d < 6 && pos < (int)size - 1; d++) {
                    frac *= 10;
                    int digit = (int)frac;
                    if (digit > 9) digit = 9;
                    buf[pos++] = '0' + digit;
                    frac -= digit;
                }
                break;
            }
            case 'c': {
                int c = va_arg(ap, int);
                buf[pos++] = (char)c;
                break;
            }
            case '%':
                buf[pos++] = '%';
                break;
            default:
                buf[pos++] = '%';
                buf[pos++] = *format;
                break;
            }
            format++;
        } else {
            buf[pos++] = *format++;
        }
    }

    if (pos < (int)size)
        buf[pos] = '\0';

    /* Return the length that would have been written (approximation) */
    return pos;
}

int fprintf(FILE *stream, const char *format, ...)
{
    (void)stream;
    (void)format;
    return 0;
}

int printf(const char *format, ...)
{
    (void)format;
    return 0;
}

unsigned long fwrite(const void *ptr, unsigned long size,
                     unsigned long nmemb, FILE *stream)
{
    (void)ptr; (void)size; (void)nmemb; (void)stream;
    return 0;
}

unsigned long fread(void *ptr, unsigned long size,
                    unsigned long nmemb, FILE *stream)
{
    (void)ptr; (void)size; (void)nmemb; (void)stream;
    return 0;
}

int getc(FILE *stream)
{
    (void)stream;
    return EOF;
}

int ferror(FILE *stream)
{
    (void)stream;
    return 0;
}

void clearerr(FILE *stream)
{
    (void)stream;
}

int fileno(FILE *stream)
{
    (void)stream;
    return -1;
}

/* ------------------------------------------------------------------ */
/*  unistd stubs                                                      */
/* ------------------------------------------------------------------ */

int isatty(int fd)
{
    (void)fd;
    return 0;  /* never a tty in WASM */
}

/* ------------------------------------------------------------------ */
/*  errno                                                             */
/* ------------------------------------------------------------------ */

int errno = 0;

/* ------------------------------------------------------------------ */
/*  process control                                                   */
/* ------------------------------------------------------------------ */

void exit(int code)
{
    (void)code;
    /* Trap — this should never be reached in normal operation */
    for (;;);
}
