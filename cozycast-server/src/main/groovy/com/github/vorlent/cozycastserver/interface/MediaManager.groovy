package com.github.vorlent.cozycastserver

import io.micronaut.websocket.WebSocketSession

class WorkerMediaInfo {
    String ip
    String videoPort
    String audioPort
}

interface MediaManager {
    WorkerMediaInfo setupWorker(WorkerSession worker)
    void processWorkerAnswer(WorkerSession worker, String sdpAnswer)
    void releaseWorker(WorkerSession worker)

    String processPlayerOffer(WorkerSession worker, UserSession user, String sessionId, String sdpOffer, Closure iceCandidateCallback)
    void addPlayerIceCandidate(UserSession user, String sessionId, Map candidate)
    void releasePlayer(UserSession user, String sessionId)
}