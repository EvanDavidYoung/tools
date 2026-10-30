// Native smoke test: decode a raw file through rp_process and write a PPM preview (sRGB-ish gamma).
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <vector>
extern "C" {
int rp_process(const unsigned char *, size_t, int, int, int, int);
const unsigned short *rp_pixels();
int rp_width(), rp_height();
const char *rp_meta();
const char *rp_strerror(int);
}
int main(int argc, char **argv)
{
  if (argc < 3) { fprintf(stderr, "usage: %s in.raw out.ppm\n", argv[0]); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) return 3;
  std::vector<unsigned char> buf;
  fseek(f, 0, SEEK_END); buf.resize(ftell(f)); fseek(f, 0, SEEK_SET);
  fread(buf.data(), 1, buf.size(), f); fclose(f);
  int rc = rp_process(buf.data(), buf.size(), getenv("FULL") ? 0 : 1, getenv("DEMOSAIC") ? atoi(getenv("DEMOSAIC")) : 3, 2, 0);
  if (rc) { fprintf(stderr, "rp_process failed: %d %s\n", rc, rp_strerror(rc)); return 1; }
  printf("%s\n", rp_meta());
  int w = rp_width(), h = rp_height();
  const unsigned short *px = rp_pixels();
  double sum = 0; unsigned short mx = 0;
  FILE *o = fopen(argv[2], "wb");
  fprintf(o, "P6\n%d %d\n255\n", w, h);
  for (long i = 0; i < (long)w * h * 3; i++)
  {
    sum += px[i]; if (px[i] > mx) mx = px[i];
    double v = pow(px[i] / 65535.0 * 4.0, 1 / 2.2);
    fputc(v > 1 ? 255 : (int)(v * 255), o);
  }
  fclose(o);
  printf("size=%dx%d mean=%.1f max=%u\n", w, h, sum / ((double)w * h * 3), mx);
  return 0;
}
