#!/bin/bash
# one-time setup on the pod: Blender 5.2.3 (same as the PC) + the libraries it needs + ffmpeg
set -x; cd /workspace
export DEBIAN_FRONTEND=noninteractive
(apt-get update -qq && apt-get install -y -qq libxi6 libxxf86vm1 libxfixes3 libxrender1 libgl1 libegl1 libxkbcommon0 libsm6 libice6 xz-utils ffmpeg) > apt.log 2>&1 &
wget -q -c https://download.blender.org/release/Blender5.2/blender-5.2.3-linux-x64.tar.xz
wait
tar xf blender-5.2.3-linux-x64.tar.xz && ln -sfn /workspace/blender-5.2.3-linux-x64/blender /usr/local/bin/blender
blender --version | head -1; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader; nproc; which ffmpeg
echo SETUP_DONE
