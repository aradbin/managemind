#!/bin/bash
# usage: osnap.sh Board [p] "state1" "state2" ... -> shots/<board>-<n>.png
b=$1; shift; ph=""; if [ "$1" = p ]; then ph=p; shift; fi
f=$b; [ -n "$ph" ] && f=${b}Phone; i=0; for s in "$@"; do i=$((i+1)); ./snap.sh $f "$s" "$b$ph-$i" $ph >/dev/null 2>&1 || echo "fail $s"; done
