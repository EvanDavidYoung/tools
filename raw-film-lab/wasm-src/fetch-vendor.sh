#!/usr/bin/env bash
# Fetches pinned LibRaw + GoPro GPR sources into ../vendor and applies the direct VC-5 patch.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."
mkdir -p vendor
fetch() { # name url commit
  if [ ! -d "vendor/$1" ]; then
    git clone --filter=blob:none "$2" "vendor/$1"
    git -C "vendor/$1" checkout -q "$3"
  fi
}
fetch LibRaw https://github.com/LibRaw/LibRaw.git 2caab57e269cc7fce17c3189e4d4d7e3e5861875
fetch gpr    https://github.com/gopro/gpr.git    446c736a38fb14f51343605c0780d347dc602f89
if git -C vendor/LibRaw apply --check "$HERE/libraw-vc5.patch" 2>/dev/null; then
  git -C vendor/LibRaw apply "$HERE/libraw-vc5.patch"
  echo "Applied libraw-vc5.patch"
fi
