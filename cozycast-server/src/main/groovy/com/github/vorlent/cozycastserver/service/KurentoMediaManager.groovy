package com.github.vorlent.cozycastserver.service

import com.github.vorlent.cozycastserver.*
import jakarta.inject.Singleton
import org.kurento.client.*
import java.util.regex.Pattern
import java.util.regex.Matcher
import groovy.util.logging.Slf4j

@Slf4j
@Singleton
class KurentoMediaManager implements MediaManager {

    private final KurentoClient kurento

    KurentoMediaManager(KurentoClient kurento) {
        this.kurento = kurento
    }

    private class KurentoWorkerConnection implements MediaConnection {
        MediaPipeline pipeline
        RtpEndpoint endpoint
        void release() { pipeline?.release() }
    }

    private class KurentoPlayerConnection implements MediaConnection {
        WebRtcEndpoint endpoint
        void release() { endpoint?.release() }
    }

    @Override
    WorkerMediaInfo setupWorker(WorkerSession worker) {
        MediaPipeline pipeline = kurento.createMediaPipeline()
        RtpEndpoint rtpEndpoint = new RtpEndpoint.Builder(pipeline).build()
        
        worker.mediaConnection = new KurentoWorkerConnection(pipeline: pipeline, endpoint: rtpEndpoint)
        String workerSDPOffer = rtpEndpoint.generateOffer()

        String videoPort = parseSdpPort(workerSDPOffer, "video")
        String audioPort = parseSdpPort(workerSDPOffer, "audio")

        return new WorkerMediaInfo(
            ip: System.getenv("KURENTO_IP"),
            videoPort: videoPort,
            audioPort: audioPort
        )
    }

    @Override
    void processWorkerAnswer(WorkerSession worker, String sdpAnswer) {
        if (worker?.mediaConnection instanceof KurentoWorkerConnection) {
            // Restore original logic: sprop-stereo fix is mandatory for the worker
            String fixedAnswer = sdpAnswer.replace("sprop-stereo:1", "sprop-stereo=1")
            ((KurentoWorkerConnection) worker.mediaConnection).endpoint.processAnswer(fixedAnswer)
        }
    }

    @Override
    void releaseWorker(WorkerSession worker) {
        worker.mediaConnection?.release()
    }

    @Override
    String processPlayerOffer(WorkerSession worker, UserSession user, String sessionId, String sdpOffer, Closure iceCandidateCallback) {
        KurentoWorkerConnection workerConn = (KurentoWorkerConnection) worker.mediaConnection
        WebRtcEndpoint webRtcEndpoint = new WebRtcEndpoint.Builder(workerConn.pipeline).build()

        if (System.getenv('NETWORK_INTERFACES')) webRtcEndpoint.setNetworkInterfaces(System.getenv('NETWORK_INTERFACES'))
        if (System.getenv('EXTERNAL_IPV4')) webRtcEndpoint.setExternalIPv4(System.getenv('EXTERNAL_IPV4'))

        workerConn.endpoint.connect(webRtcEndpoint)

        webRtcEndpoint.addIceCandidateFoundListener(new EventListener<IceCandidateFoundEvent>() {
            void onEvent(IceCandidateFoundEvent event) {
                iceCandidateCallback([
                    candidate: event.candidate.candidate,
                    sdpMid: event.candidate.sdpMid,
                    sdpMLineIndex: event.candidate.sdpMLineIndex
                ])
            }
        })

        String sdpAnswer = webRtcEndpoint.processOffer(sdpOffer)
        user.connections.get(sessionId).mediaConnection = new KurentoPlayerConnection(endpoint: webRtcEndpoint)
        
        webRtcEndpoint.gatherCandidates()
        return sdpAnswer
    }

    @Override
    void addPlayerIceCandidate(UserSession user, String sessionId, Map candidateData) {
        def conn = user.connections.get(sessionId)?.mediaConnection
        if (conn instanceof KurentoPlayerConnection) {
            conn.endpoint.addIceCandidate(new IceCandidate(candidateData.candidate, candidateData.sdpMid, candidateData.sdpMLineIndex))
        }
    }

    @Override
    void releasePlayer(UserSession user, String sessionId) {
        user.connections.get(sessionId)?.mediaConnection?.release()
    }

    private String parseSdpPort(String sdp, String type) {
        Matcher matcher = Pattern.compile("m=${type} (\\d+)").matcher(sdp)
        return matcher.find() ? matcher.group(1) : null
    }
}