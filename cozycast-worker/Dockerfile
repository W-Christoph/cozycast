FROM ubuntu:24.04 AS builder
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    curl \
    pkg-config \
    libssl-dev \
    libgstreamer1.0-dev \
    libgstreamer-plugins-base1.0-dev \
    libgstreamer-plugins-bad1.0-dev \
    libglib2.0-dev

# Install latest Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /build
RUN git clone --depth 1 https://gitlab.freedesktop.org/gstreamer/gst-plugins-rs.git

WORKDIR /build/gst-plugins-rs
RUN cargo build --release --package gst-plugin-webrtc

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

# Copy the built library from the builder stage
COPY --from=builder /build/gst-plugins-rs/target/release/libgstrswebrtc.so /usr/lib/x86_64-linux-gnu/gstreamer-1.0/

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
