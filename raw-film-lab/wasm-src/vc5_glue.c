// Bridges LibRaw's VC-5 (GoPro GPR) loader to the GoPro vc5_decoder library.
#include <stdlib.h>
#include <string.h>
#include "vc5_decoder.h"

int libraw_vc5_decode(const void *src, size_t srclen, int rggb14,
                      unsigned short *dst, unsigned width, unsigned height)
{
    vc5_decoder_parameters params;
    vc5_decoder_parameters_set_default(&params);
    params.mem_alloc = malloc;
    params.mem_free = free;
    params.pixel_format = rggb14 ? VC5_DECODER_PIXEL_FORMAT_RGGB_14 : VC5_DECODER_PIXEL_FORMAT_GBRG_12;

    gpr_buffer in = {(void *)src, srclen};
    gpr_buffer out = {NULL, 0};
    if (vc5_decoder_process(&params, &in, &out, NULL) != CODEC_ERROR_OKAY)
        return 1;
    size_t need = (size_t)width * height * sizeof(unsigned short);
    if (!out.buffer || out.size < need) {
        free(out.buffer);
        return 2;
    }
    memcpy(dst, out.buffer, need);
    free(out.buffer);
    return 0;
}
