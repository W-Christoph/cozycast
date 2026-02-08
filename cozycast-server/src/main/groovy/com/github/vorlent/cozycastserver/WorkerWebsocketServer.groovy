package com.github.vorlent.cozycastserver

import io.micronaut.websocket.annotation.OnClose
import io.micronaut.websocket.annotation.OnMessage
import io.micronaut.websocket.annotation.OnOpen
import io.micronaut.websocket.annotation.ServerWebSocket
import io.micronaut.websocket.WebSocketSession

import java.util.concurrent.ConcurrentHashMap

import java.util.regex.Pattern
import java.util.regex.Matcher

import groovy.util.logging.Slf4j

class SDPOffer {

    String type = 'sdpOffer'
    String ip
    String videoPort
    String audioPort

}

class SDPAnswer {

    String type = 'sdpAnswer'
    String content

}

class WindowTitleEvent {

    String action = 'window_title'
    String title

}

class UpdateWorkerSettingsEvent {

    String action = 'worker_update_settings'
    VideoSettings settings
    Boolean restart

}

@Slf4j
@ServerWebSocket('/worker/{room}/{room_key}')
class WorkerWebsocketServer {

    private MediaManager mediaManager
    private RoomRegistry roomRegistry
    private String accessKey = System.getenv('COZYCAST_WORKER_KEY')

    WorkerWebsocketServer(MediaManager mediaManager,
        RoomRegistry roomRegistry) {
        this.mediaManager = mediaManager
        this.roomRegistry = roomRegistry
        log.info "test $accessKey"
        }

    @OnOpen
    void onOpen(String room, String room_key, WebSocketSession session) {
        if (room_key != accessKey) {
            log.info "tried to access $room with invalid key $room_key"
            session.close()
            return
        }

        WorkerSession worker = new WorkerSession()
        worker.websocket = session
        WorkerMediaInfo info = mediaManager.setupWorker(worker) // Isolated Kurento logic

        def roomObj = roomRegistry.getRoom(room)
        session.sendSync(new UpdateWorkerSettingsEvent(settings: roomObj.videoSettings, restart: false))
        session.sendSync(new SDPOffer(
            ip: System.getenv('KURENTO_IP'),
            videoPort: info.videoPort,
            audioPort: info.audioPort
        ))
        roomObj.startStream(worker)
    }

    private void windowtitle(Room room, WebSocketSession session, Map jsonMessage) {
        if (room.title != jsonMessage.title) {
            room.title = jsonMessage.title
            room.users.each { key, value ->
                value.connections.each { sessionId, connection ->
                    connection.webSocketSession.sendSync(new WindowTitleEvent(
                    title: (room.title ?: '')
                ))
                }
            }
        }
    }

    @OnMessage
    void onMessage(String room, Map answer, WebSocketSession session) {
        if (answer.action == 'sdpAnswer') {
            mediaManager.processWorkerAnswer(roomRegistry.getRoom(room).worker, answer.content)
        }
        if (answer.action == 'keepalive') {
            session.sendSync([
                action: 'keepalive'
            ])
        }
        if (answer.action == 'window_title') {
            windowtitle(roomRegistry.getRoom(room), session, answer)
        }
    }

    @OnClose
    void onClose(String room, WebSocketSession session) {
        Room roomObj = roomRegistry.getRoomNoCreate(room)
        if (roomObj) {
            WorkerSession worker = roomObj.worker
            if (!(worker?.websocket?.getId() == session.getId())) return
            log.info "Closed websocket session to worker of ${room}"
            roomObj.stopStream()
        }
    }

}
