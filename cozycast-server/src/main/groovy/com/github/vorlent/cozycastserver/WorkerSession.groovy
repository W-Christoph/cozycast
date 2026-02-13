package com.github.vorlent.cozycastserver

import io.micronaut.websocket.WebSocketSession

class WorkerSession {

    MediaConnection mediaConnection
    WebSocketSession websocket

    String whipUrl
    String streamKey

    void close() {
        mediaConnection?.release()
    }

}
