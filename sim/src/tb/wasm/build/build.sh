#!/bin/sh
# Rebuilds dist/ from scratch. Requires: emscripten (emcc/em++ on PATH; tested with 6.0.2 from Homebrew),
# autoconf, automake, bison, flex, gperf, python3. Keep -j4 on 8 GB machines.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
[ -d src ] || git clone --depth 1 --branch v13-branch https://github.com/steveicarus/iverilog src
cd src
git apply --check ../dist/patches/0001-iverilog-wasm-static-modules-inprocess-exec.patch 2>/dev/null && \
  git apply ../dist/patches/0001-iverilog-wasm-static-modules-inprocess-exec.patch
sh autoconf.sh
emconfigure ./configure --prefix=/usr/local --host=wasm32-unknown-emscripten
emmake make -j4 -k version_tag.h dep config.h _pli_types.h || true
# object files only; the final links are done below (the Makefile links fail: no dlopen, no version.exe)
emmake make -j4 -k CFLAGS="-O2" CXXFLAGS="-O2 -std=c++11" LDFLAGS= ivl || true
emmake make -j4 -k -C tgt-vvp CFLAGS="-O2" CXXFLAGS="-O2 -std=c++11" LDFLAGS= || true
emmake make -j4 -k -C vpi     CFLAGS="-O2" CXXFLAGS="-O2 -std=c++11" LDFLAGS= || true
emmake make -j4 -k -C vvp     CFLAGS="-O2" CXXFLAGS="-O2 -std=c++11" LDFLAGS= || true
# driver and ivlpp share global names with ivl; rename them via -D since all three are one binary
DRV='-Ddestroy_lexor=drv_destroy_lexor -DCOPYRIGHT=drv_COPYRIGHT -DNOTICE=drv_NOTICE -Dverbose_flag=drv_verbose_flag -Dvhdlpp_libdir=drv_vhdlpp_libdir -Dvhdlpp_libdir_cnt=drv_vhdlpp_libdir_cnt -Dvhdlpp_work=drv_vhdlpp_work -Dinteger_width=drv_integer_width -Dwidth_cap=drv_width_cap -Dignore_missing_modules=drv_ignore_missing_modules'
PP='-Dverbose_flag=pp_verbose_flag -Ddepend_file=pp_depend_file -Derror_count=pp_error_count'
emmake make -j4 -k -C driver CFLAGS="-O2" LDFLAGS= CPPFLAGS="\$(INCLUDE_PATH) -DHAVE_CONFIG_H $DRV" || true
emmake make -j4 -k -C ivlpp  CFLAGS="-O2" LDFLAGS= CPPFLAGS="\$(INCLUDE_PATH) -DHAVE_CONFIG_H $PP" || true
# wasm glue
em++ -c -O2 -DIVL_STATIC_TARGETS -I. wasm/ivl_static_modules.cc -o wasm/ivl_static_modules_ivl.o
em++ -c -O2 -I. wasm/ivl_static_modules.cc -o wasm/ivl_static_modules_vvp.o
emcc -c -O2 wasm/ivl_wasm_system.c -o wasm/ivl_wasm_system.o
# files the driver expects under $prefix/lib/ivl (embedded into iverilog.wasm)
mkdir -p ../lib/ivl/include
cp tgt-vvp/vvp.conf tgt-vvp/vvp-s.conf ../lib/ivl/
cp constants.vams disciplines.vams ../lib/ivl/include/
FLAGS="-O2 -sALLOW_MEMORY_GROWTH=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sFORCE_FILESYSTEM=1 -sEXIT_RUNTIME=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -sSTACK_SIZE=8388608"
mkdir -p ../dist
em++ $FLAGS -sEXPORT_NAME=createVvp -o ../dist/vvp.mjs vvp/*.o vpi/*.o wasm/ivl_static_modules_vvp.o
em++ $FLAGS -sEXPORT_NAME=createIverilog --embed-file ../lib/ivl@/usr/local/lib/ivl -o ../dist/iverilog.mjs \
  driver/*.o ivlpp/*.o *.o tgt-vvp/*.o vpi/*.o wasm/ivl_static_modules_ivl.o wasm/ivl_wasm_system.o
ls -la ../dist
