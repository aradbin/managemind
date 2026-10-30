#!/bin/bash
# usage: snap.sh Board "startOn" out [phone]
mkdir -p shots; f=canvas/project/$1.dc.html
if [ -n "$4" ]; then w=390; h=844; else w=1440; h=900; fi
node render.cjs $f shots/$3.html "{\"startOn\":\"$2\"}" && node shot2.cjs shots/$3.html shots/$3.png $w $h
