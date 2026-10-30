# Raw Film Lab

Develop RAW photos in the browser and give them a film look. Served at
`tools.evanyoung.dev/raw-film-lab/`.

Opens GoPro `.GPR`, iPhone ProRAW and other `.DNG`s, and most camera RAWs (CR2/CR3, NEF, ARW, RAF, ORF,
RW2, …), plus JPEG/PNG and log-encoded stills (Apple Log, S-Log3, LogC3). Decoding happens in a Web
Worker running LibRaw compiled to WebAssembly; edits run in one WebGL2 shader. Nothing is uploaded.

This tool breaks the single-file rule: the RAW decoder is a 1 MB WebAssembly build, so it ships as
`index.html` + `style.css` + `js/` + `wasm/` + `luts/`. There is still no build step to deploy it —
the `.wasm` is committed. Rebuild it only when changing the decoder.

## Layout

| Path | What |
|---|---|
| `index.html`, `style.css`, `js/` | The app (ES modules, no bundler) |
| `wasm/rawproc.{js,wasm}` | Built decoder — LibRaw + GoPro VC-5 |
| `luts/`, `luts.json` | 28 film-stock HaldCLUTs from the RawTherapee Film Simulation Collection, resampled from level 12 to level 8 (64³; ≈47 dB PSNR vs. the originals) |
| `wasm-src/` | Decoder source: C API, LibRaw patch, Makefile, pinned fetch script (not served) |

## Rebuilding the decoder

```bash
cd raw-film-lab/wasm-src
./fetch-vendor.sh      # clones pinned LibRaw + gopro/gpr into ../vendor and applies libraw-vc5.patch
make wasm              # needs emscripten (brew install emscripten) → ../wasm/rawproc.{js,wasm}
make native            # optional: native build for checking against desktop tools
```

`libraw-vc5.patch` lets LibRaw decode GoPro's VC-5 codec by calling GoPro's `vc5_decoder` directly,
instead of going through the Adobe DNG SDK as upstream LibRaw does. The raw data matches Adobe DNG
Converter's output exactly.

## Not supported

- iPhone ProRAW saved as **JPEG-XL** (iPhone 16 Pro and later can do this). Set the ProRAW format to
  “JPEG Lossless (Most Compatible)”.
- HEIC outside Safari.

## Licenses

- LibRaw: LGPL 2.1 or CDDL 1.0. The patch and the build scripts in `wasm-src/` let you rebuild and
  relink it.
- GoPro GPR SDK (VC-5 decoder): Apache 2.0 or MIT.
- Film LUTs: CC BY-SA 4.0. Pat David, Pavlov Dmitry, Michael Ezra; see `luts/README.txt`. Film names are
  trademarks of their owners, used only to say which stock a LUT approximates.
