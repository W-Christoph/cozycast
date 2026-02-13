#!/bin/bash
OPTIONS=${@:1}

# 1. Clean up
if [ -f "/home/cozycast/ffmpeg.pid" ]; then
    kill -9 $(cat /home/cozycast/ffmpeg.pid) 2>/dev/null
    rm /home/cozycast/ffmpeg.pid
fi

# 2. Environment (Critical for finding whipclientsink)
export GST_PLUGIN_PATH=/usr/lib/x86_64-linux-gnu/gstreamer-1.0
export DISPLAY=:0
export PULSE_SERVER=unix:/tmp/pulse-socket
export GST_DEBUG=pulsesrc:5

# 3. Cache Management
# We fix ownership of the cache folder to prevent "Permission denied"
chown -R cozycast:cozycast /home/cozycast/.cache
sudo -u cozycast rm -rf /home/cozycast/.cache/gstreamer-1.0

# 4. Run
echo "Starting WHIP Stream with whipclientsink..."
sudo -E -u cozycast gst-launch-1.0 -e $OPTIONS &

echo $! > /home/cozycast/ffmpeg.pid