FROM ubuntu:24.04
ENV REPO="noble"

RUN export DEBIAN_FRONTEND=noninteractive && \
    apt-get update && \
    apt-get install -y git cmake lua5.1 lua5.1-dev luajit libssl-dev m4 luarocks xdotool pulseaudio \
    libnss3 libcurl3-gnutls sudo xfce4 xfce4-terminal xclip fonts-wqy-microhei inotify-tools vlc \
    gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-nice \
    xvfb dbus-x11 \
    && apt-get remove -y xfce4-screensaver && \
    # Create the directory for the GStreamer plugin volume mount
    mkdir -p /usr/lib/x86_64-linux-gnu/gstreamer-1.0/

ENV UNAME cozycast

RUN export UNAME=$UNAME UID=1000 GID=1000 && \
    mkdir -p "/home/${UNAME}" && \
    echo "${UNAME}:x:${UID}:${GID}:${UNAME} User,,,:/home/${UNAME}:/bin/bash" >> /etc/passwd && \
    echo "${UNAME}:x:${UID}:" >> /etc/group && \
    echo "${UNAME} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/cozycast

ENV TINI_VERSION="v0.19.0"
ADD https://github.com/krallin/tini/releases/download/v0.19.0/tini /tini
RUN chmod +x /tini
ENTRYPOINT ["/tini", "--"]
COPY cozycast-worker-1.0-1.rockspec .
COPY vendor /tmp/vendor
RUN cd / && luarocks make

COPY install-firefox.sh /tmp/
RUN /tmp/install-firefox.sh

COPY . .

#USER $UNAME
ENV HOME /home/cozycast
ENV DISPLAY :0

CMD ["/entrypoint.sh"]
