#include <cstdio>
#include "libraw/libraw.h"
int main(int argc, char **argv) {
  LibRaw r; if (r.open_file(argv[1]) || r.unpack()) { puts("fail"); return 1; }
  auto &s = r.imgdata.sizes; auto *img = r.imgdata.rawdata.raw_image;
  printf("filters=%x black=%u max=%u cblack=%u,%u,%u,%u linear_max=%g\n", r.imgdata.idata.filters, r.imgdata.color.black, r.imgdata.color.maximum,
    r.imgdata.color.cblack[0], r.imgdata.color.cblack[1], r.imgdata.color.cblack[2], r.imgdata.color.cblack[3], r.imgdata.color.linear_max[0]);
  double sum[4] = {0}; unsigned mx[4] = {0}; long n[4] = {0};
  for (int y = 0; y < s.raw_height; y++) for (int x = 0; x < s.raw_width; x++) {
    int k = (y & 1) * 2 + (x & 1); unsigned v = img[y * s.raw_pitch / 2 + x];
    sum[k] += v; n[k]++; if (v > mx[k]) mx[k] = v; }
  for (int k = 0; k < 4; k++) printf("pos%d mean=%.1f max=%u\n", k, sum[k] / n[k], mx[k]);
  unsigned long long hsh = 1469598103934665603ULL;
  for (int y = 0; y < s.raw_height; y++) for (int x = 0; x < s.raw_width; x++) { hsh ^= img[y * s.raw_pitch / 2 + x]; hsh *= 1099511628211ULL; }
  printf("raw fnv1a=%016llx\n", hsh);
  printf("row0: "); for (int x = 1000; x < 1008; x++) printf("%u ", img[1500 * s.raw_pitch / 2 + x]); puts("");
}
