#!/bin/bash
# Rebuild every built board, then link them and apply the shared layout.
set -e
cd "$(dirname "$0")"
for s in inv/build.py ord/obuild.py rep/rbuild.py set/sbuild.py web/wbuild.py misc/mbuild.py plat/pbuild.py imp/ibuild.py wire.py layout.py; do python3 $s > /dev/null; done
echo rebuilt
