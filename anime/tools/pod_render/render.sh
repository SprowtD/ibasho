#!/bin/bash
# render.sh NAME FRAME0 FRAME1 CHUNKS [W H] : films frames FRAME0..FRAME1 of /workspace/in/score.json in CHUNKS Blender processes side by side on the GPU
NAME=$1; A=$2; B=$3; N=$4; W=${5:-854}; H=${6:-480}; FPS=24
cd /workspace; O=out/$NAME; rm -rf $O; mkdir -p $O/all; export PREVIS_DEVICE=GPU; START=$(date +%s)
for k in $(seq 0 $((N-1))); do
  a=$(( A + (B-A)*k/N )); b=$(( A + (B-A)*(k+1)/N )); echo "$a $b" > $O/c$k.range
  t0=$(python3 -c "print($a/$FPS)"); t1=$(python3 -c "print($b/$FPS)")
  blender -b -P in/previs_blender.py -- in/score.json $O/c$k $t0 $t1 $W $H $FPS > $O/c$k.log 2>&1 &
done
wait
for k in $(seq 0 $((N-1))); do read a b < $O/c$k.range; grep -q PREVIS_DONE $O/c$k.log || echo "CHUNK $k FAILED"; i=0; for f in $(ls $O/c$k/f*.png); do mv $f $O/all/$(printf 'f%05d.png' $((a - A + i))); i=$((i+1)); done; done
grep -h PREVIS_GPU $O/c0.log | head -2
echo "frames: $(ls $O/all | wc -l) of $((B-A)); seconds: $(( $(date +%s) - START ))"
ffmpeg -v error -y -framerate $FPS -i $O/all/f%05d.png -c:v libx264 -crf 16 -pix_fmt yuv420p out/$NAME.mp4 && ls -l out/$NAME.mp4
echo RENDER_DONE
