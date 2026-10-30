# Builds LibRaw + GoPro VC-5 decoder.
#   make native   -> ./build/native/test_native  (smoke test with system clang)
#   make wasm     -> ../public/wasm/rawproc.{js,wasm} (needs emscripten)
VENDOR   := ../vendor
LIBRAW   := $(VENDOR)/LibRaw
GPR      := $(VENDOR)/gpr/source/lib

LIBRAW_SRC := $(filter-out %_ph.cpp, $(wildcard $(LIBRAW)/src/*/*.cpp $(LIBRAW)/src/*.cpp))
VC5_SRC    := $(wildcard $(GPR)/vc5_decoder/*.c $(GPR)/vc5_common/*.c) \
              $(GPR)/common/private/gpr_allocator.c $(GPR)/common/private/gpr_buffer.c $(GPR)/common/private/log.c $(GPR)/common/private/timer.c
GLUE_SRC   := vc5_glue.c rawproc.cpp

DEFS     := -DUSE_VC5_DIRECT -DLIBRAW_NOTHREADS -DNO_LCMS -DGPR_WRITING=0 -DGPR_READING=1 -DGPR_TIMING=0
INCS     := -I$(LIBRAW) -I$(GPR)/vc5_decoder -I$(GPR)/vc5_common -I$(GPR)/common/public -I$(GPR)/common/private
WARN     := -w

native: build/native/test_native build/native/cfa_stats
build/native/libraw.a: $(LIBRAW_SRC) $(VC5_SRC) $(GLUE_SRC)
	@mkdir -p build/native/obj
	cd build/native/obj && for f in $(abspath $(VC5_SRC)) $(abspath vc5_glue.c); do \
	  clang -O2 -std=gnu99 $(WARN) $(DEFS) $(patsubst -I%,-I$(CURDIR)/%,$(INCS)) -c $$f -o $$(basename $$(dirname $$f))_$$(basename $$f).o || exit 1; done
	cd build/native/obj && printf '%s\n' $(abspath $(LIBRAW_SRC)) $(abspath rawproc.cpp) | xargs -P 8 -n 1 sh -c \
	  'clang++ -O2 -std=c++17 $(WARN) $(DEFS) $(patsubst -I%,-I$(CURDIR)/%,$(INCS)) -c $$0 -o $$(basename $$(dirname $$0))_$$(basename $$0).o'
	ar rcs $@ build/native/obj/*.o
build/native/test_native: build/native/libraw.a test_native.cpp
	clang++ -O2 -std=c++17 $(WARN) $(INCS) test_native.cpp build/native/libraw.a -o $@
build/native/cfa_stats: build/native/libraw.a cfa_stats.cpp
	clang++ -O2 -std=c++17 $(WARN) $(INCS) cfa_stats.cpp build/native/libraw.a -o $@

OUT ?= ../wasm
EMFLAGS := -O3 -fwasm-exceptions -sUSE_ZLIB=1 -sUSE_LIBJPEG=1
LINKFLAGS := -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createRawProc -sENVIRONMENT=web,worker \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sINITIAL_MEMORY=64MB -sSTACK_SIZE=4MB \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_rp_process,_rp_pixels,_rp_width,_rp_height,_rp_colors,_rp_meta,_rp_strerror,_rp_version,_rp_free \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16,UTF8ToString

wasm: $(OUT)/rawproc.js
build/wasm/libraw.a: $(LIBRAW_SRC) $(VC5_SRC) $(GLUE_SRC)
	@mkdir -p build/wasm/obj
	cd build/wasm/obj && printf '%s\n' $(abspath $(VC5_SRC)) $(abspath vc5_glue.c) | xargs -P 8 -n 1 sh -c \
	  'emcc $(EMFLAGS) -std=gnu99 -include stdint.h $(WARN) $(DEFS) $(patsubst -I%,-I$(CURDIR)/%,$(INCS)) -c $$0 -o $$(basename $$(dirname $$0))_$$(basename $$0).o'
	cd build/wasm/obj && printf '%s\n' $(abspath $(LIBRAW_SRC)) $(abspath rawproc.cpp) | xargs -P 8 -n 1 sh -c \
	  'em++ $(EMFLAGS) -std=c++17 $(WARN) $(DEFS) -DUSE_JPEG -DUSE_ZLIB $(patsubst -I%,-I$(CURDIR)/%,$(INCS)) -c $$0 -o $$(basename $$(dirname $$0))_$$(basename $$0).o'
	emar rcs $@ build/wasm/obj/*.o
$(OUT)/rawproc.js: build/wasm/libraw.a
	@mkdir -p $(OUT)
	em++ $(EMFLAGS) build/wasm/libraw.a $(LINKFLAGS) -o $@

clean:
	rm -rf build

.PHONY: native wasm clean
