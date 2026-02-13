package com.github.vorlent.cozycastserver

class WorkerMediaInfo {
    String whipUrl
    String streamKey
}

interface MediaManager {
    WorkerMediaInfo setupWorker(String roomName)
    String getPlayerToken(String roomName, String identity, String nickname)
}