package com.github.vorlent.cozycastserver

import io.micronaut.websocket.WebSocketSession

class WorkerSession {

    MediaConnection mediaConnection
    WebSocketSession websocket

    void close() {
        mediaConnection?.release()
    }

}
