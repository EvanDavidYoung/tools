// Thin C API over LibRaw for the browser editor.
// Output: 16-bit linear RGB in ProPhoto primaries (1.0 == sensor white), plus JSON metadata.
#include <cstdio>
#include <cstring>
#include <string>
#include "libraw/libraw.h"

static LibRaw *g_raw = nullptr;
static libraw_processed_image_t *g_img = nullptr;
static std::string g_meta;

static void release()
{
  if (g_img) { LibRaw::dcraw_clear_mem(g_img); g_img = nullptr; }
  if (g_raw) { g_raw->recycle(); }
}

static std::string jstr(const char *s)
{
  std::string o = "\"";
  for (; s && *s; s++)
  {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') { o += '\\'; o += (char)c; }
    else if (c >= 0x20) o += (char)c;
  }
  return o + "\"";
}

extern "C" {

// demosaic: LibRaw user_qual (0 linear, 1 VNG, 2 PPG, 3 AHD, 4 DCB, 11 DHT, 12 AAHD)
// highlight: 0 clip, 1 unclip, 2 blend, 3..9 rebuild
// wb: 0 as shot, 1 auto, 2 daylight (camera matrix only)
// Returns 0 on success, otherwise a LibRaw error code.
int rp_process(const unsigned char *data, size_t len, int half, int demosaic,
               int highlight, int wb)
{
  if (!g_raw) g_raw = new LibRaw(LIBRAW_OPIONS_NO_DATAERR_CALLBACK);
  release();

  libraw_output_params_t &p = g_raw->imgdata.params;
  p.output_bps = 16;
  p.gamm[0] = 1.0;
  p.gamm[1] = 1.0;
  p.no_auto_bright = 1;
  p.bright = 1.0f;
  p.output_color = 4; // ProPhoto: wide enough to keep saturated colors
  p.half_size = half ? 1 : 0;
  p.user_qual = demosaic;
  p.highlight = highlight;
  p.use_camera_wb = wb == 0 ? 1 : 0;
  p.use_auto_wb = wb == 1 ? 1 : 0;
  p.use_camera_matrix = 1;

  int rc = g_raw->open_buffer(data, len);
  if (rc != LIBRAW_SUCCESS) return rc;
  rc = g_raw->unpack();
  if (rc != LIBRAW_SUCCESS) return rc;
  rc = g_raw->dcraw_process();
  if (rc != LIBRAW_SUCCESS) return rc;
  g_img = g_raw->dcraw_make_mem_image(&rc);
  if (!g_img) return rc ? rc : LIBRAW_UNSPECIFIED_ERROR;

  const libraw_data_t &d = g_raw->imgdata;
  char buf[1024];
  snprintf(buf, sizeof buf,
           ",\"width\":%d,\"height\":%d,\"rawWidth\":%d,\"rawHeight\":%d,\"colors\":%d,"
           "\"iso\":%g,\"shutter\":%g,\"aperture\":%g,\"focal\":%g,\"timestamp\":%lld,"
           "\"baselineExposure\":%g,\"camMul\":[%g,%g,%g,%g],\"preMul\":[%g,%g,%g,%g],"
           "\"blackLevel\":%u,\"whiteLevel\":%u,\"bayer\":%s,\"flip\":%d",
           g_img->width, g_img->height, d.sizes.raw_width, d.sizes.raw_height, g_img->colors,
           d.other.iso_speed, d.other.shutter, d.other.aperture, d.other.focal_len,
           (long long)d.other.timestamp, d.color.dng_levels.baseline_exposure,
           d.color.cam_mul[0], d.color.cam_mul[1], d.color.cam_mul[2], d.color.cam_mul[3],
           d.color.pre_mul[0], d.color.pre_mul[1], d.color.pre_mul[2], d.color.pre_mul[3],
           d.color.black, d.color.maximum, d.idata.filters ? "true" : "false", d.sizes.flip);
  g_meta = "{\"make\":" + jstr(d.idata.make) + ",\"model\":" + jstr(d.idata.model) +
           ",\"software\":" + jstr(d.idata.software) + buf + "}";
  return 0;
}

const unsigned short *rp_pixels() { return g_img ? (const unsigned short *)g_img->data : nullptr; }
int rp_width() { return g_img ? g_img->width : 0; }
int rp_height() { return g_img ? g_img->height : 0; }
int rp_colors() { return g_img ? g_img->colors : 0; }
const char *rp_meta() { return g_meta.c_str(); }
const char *rp_strerror(int code) { return libraw_strerror(code); }
const char *rp_version() { return LibRaw::version(); }
void rp_free() { release(); }

}
