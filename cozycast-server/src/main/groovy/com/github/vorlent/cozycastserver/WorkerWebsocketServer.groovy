package com.github.vorlent.cozycastserver

import io.micronaut.websocket.WebSocketBroadcaster
import io.micronaut.websocket.annotation.OnClose
import io.micronaut.websocket.annotation.OnMessage
import io.micronaut.websocket.annotation.OnOpen
import io.micronaut.websocket.annotation.ServerWebSocket
import io.micronaut.websocket.WebSocketSession
import io.micronaut.websocket.CloseReason

import java.util.concurrent.ConcurrentHashMap

import java.util.regex.Pattern
import java.util.regex.Matcher

import org.kurento.client.KurentoClient
import org.kurento.client.MediaPipeline
import org.kurento.client.RtpEndpoint
import groovy.util.logging.Slf4j

class SDPOffer {
    String type = "sdpOffer"
    String ip
    String videoPort
    String audioPort
}

class SDPAnswer {
    String type = "sdpAnswer"
    String content
}

@Slf4j
@ServerWebSocket("/worker/{room}")
class WorkerWebsocketServer {

    private WebSocketBroadcaster broadcaster
    private KurentoClient kurento
    private RoomRegistry roomRegistry

    WorkerWebsocketServer(WebSocketBroadcaster broadcaster, KurentoClient kurento,
        RoomRegistry roomRegistry) {
        this.broadcaster = broadcaster
        this.kurento = kurento
        this.roomRegistry = roomRegistry
    }

    @OnOpen
    void onOpen(String room, WebSocketSession session) {
        log.info "New Worker ${session}"
        WorkerSession worker = new WorkerSession()
        worker.websocket = session
        roomRegistry.getRoom(room).worker = worker

        MediaPipeline pipeline = worker.getMediaPipeline(kurento)
        RtpEndpoint rtpEndpoint = new RtpEndpoint.Builder(pipeline).build()
        worker.rtpEndpoint = rtpEndpoint
        String workerSDPOffer = rtpEndpoint.generateOffer()

        String videoPort = null
        Matcher videoMatcher = Pattern.compile("m=video (\\d+)").matcher(workerSDPOffer)
        if(videoMatcher.find()) {
            videoPort = videoMatcher.group(1)
        }

        String audioPort = null
        Matcher audioMatcher = Pattern.compile("m=audio (\\d+)").matcher(workerSDPOffer)
        if(audioMatcher.find()) {
            audioPort = audioMatcher.group(1)
        }
        log.info "SDP Offer:\n${workerSDPOffer}"

        session.sendSync(new SDPOffer(
            ip: System.getenv("KURENTO_IP"),
            videoPort: videoPort,
            audioPort: audioPort
        ))

        roomRegistry.getRoom(room).users.each { key, user ->
            if(user != null) {
                user.release()
                if(user.webSocketSession) {
                    try {
                        user.webSocketSession.close(CloseReason.SERVICE_RESTART)
                    } catch(IOException e) {
                        e.printStackTrace()
                    }
                }
            }
        }
    }

    @OnMessage
    void onMessage(String room, SDPAnswer answer) {
        String content = answer.content.replace("sprop-stereo:1", "sprop-stereo=1")
        log.info "SDP Answer:\n${content}"
        roomRegistry.getRoom(room).worker?.rtpEndpoint?.processAnswer(content)
    }

    @OnClose
    void onClose(String room, WebSocketSession session) {
        WorkerSession worker = roomRegistry.getRoom(room).worker
        worker?.close()
        roomRegistry.getRoom(room).worker = null
    }
}