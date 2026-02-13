#!/bin/bash

if test -z "$ACTIVATE_SUDO"; then
    echo "/entrypoint.sh: no sudo"
else
    echo "${UNAME} ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/${UNAME}
    chmod 0440 /etc/sudoers.d/${UNAME}
    chown ${UID}:${GID} -R /home/${UNAME}
    gpasswd -a ${UNAME} audio
fi

touch /worker.restart

# run dbus for pulseaudio
mkdir -p /var/run/dbus

# FIX: Remove stale PID files that prevent DBus from starting on restart
rm -f /var/run/dbus/pid /run/dbus/pid

dbus-uuidgen > /var/lib/dbus/machine-id
dbus-daemon --config-file=/usr/share/dbus-1/system.conf --print-address --fork

# FIX: Ensure DISPLAY matches what worker.lua uses (:0)
export DISPLAY=":0"
sudo chown cozycast:cozycast /home/cozycast

eval $(luarocks path --bin)

function restart {
    echo "/entrypoint.sh: restarting"
    if [ -f "/worker.pid" ]; then
        # Suppress errors if the process is already dead
        kill -9 $(cat /worker.pid) 2>/dev/null
        rm /worker.pid
    fi
    (luajit worker.lua) &
    echo $! >> /worker.pid
}

restart

while inotifywait -e modify /worker.lua /worker.restart
do
    restart
done