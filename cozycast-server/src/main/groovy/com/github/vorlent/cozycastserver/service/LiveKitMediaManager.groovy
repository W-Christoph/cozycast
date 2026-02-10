package com.github.vorlent.cozycastserver.service

import com.github.vorlent.cozycastserver.*
import jakarta.inject.Singleton
// This includes AccessToken, RoomJoin, Room, etc.
import io.livekit.server.* 

@Singleton
class LiveKitMediaManager implements MediaManager {

    private final String apiKey = System.getenv('LIVEKIT_API_KEY')
    private final String apiSecret = System.getenv('LIVEKIT_API_SECRET')
    private final String livekitUrl = System.getenv('LIVEKIT_URL')
    private final String ingressUrl = System.getenv('LIVEKIT_INGRESS_URL') ?: "http://localhost:8080"

    @Override
    WorkerMediaInfo setupWorker(String roomName) {
        return new WorkerMediaInfo(
            // Point to the Ingress service port and the /w endpoint
            whipUrl: "${ingressUrl}/w", 
            streamKey: "key_${roomName}"
        )
    }

    @Override
    String getPlayerToken(String roomName, String identity, String nickname) {
        AccessToken token = new AccessToken(apiKey, apiSecret)
        token.setIdentity(identity)
        token.setName(nickname)
    
        // Use the specific grant setters on the token instance
        // This internally manages the VideoGrant object for you
        token.addGrants(new RoomJoin(true))
        token.addGrants(new RoomName(roomName))
    
        return token.toJwt()
    }

    @Override
    void processWorkerAnswer(WorkerSession worker, String roomName, String sdp) {
        try {
            // Construct WHIP URL (e.g., http://ingress:8080/w/key_default)
            String whipUrlWithKey = "${ingressUrl}/w/key_${roomName}"
            URL url = new URL(whipUrlWithKey)
            HttpURLConnection connection = (HttpURLConnection) url.openConnection()
            connection.setRequestMethod("POST")
            connection.setRequestProperty("Content-Type", "application/sdp")
            connection.setDoOutput(true)

            // Send Worker's SDP Offer
            connection.outputStream.withWriter { it.write(sdp) }

            if (connection.responseCode in [200, 201]) {
                String answerSdp = connection.inputStream.text
                
                // Parse the answer SDP for the Ingress IP and ports
                String ip = url.host
                int audioPort = -1
                int videoPort = -1

                // Extract IP from c=IN IP4 line
                def ipMatcher = answerSdp =~ /c=IN IP4 ([^ \r\n]+)/
                if (ipMatcher.find() && ipMatcher[0][1] != "0.0.0.0") ip = ipMatcher[0][1]

                // Extract ports from m= lines
                answerSdp.eachLine { line ->
                    if (line.startsWith("m=audio ")) audioPort = line.split(" ")[1].toInteger()
                    if (line.startsWith("m=video ")) videoPort = line.split(" ")[1].toInteger()
                }

                // Send the "SDP Offer" (actually the WHIP Answer) back to the worker
                worker.websocket.sendSync([
                    type: 'sdpOffer',
                    ip: ip,
                    audioPort: audioPort,
                    videoPort: videoPort
                ])
            } else {
                log.error("WHIP POST failed: ${connection.responseCode} ${connection.responseMessage}")
            }
        } catch (Exception e) {
            log.error("Error in WHIP handshake", e)
        }
    }

    @Override
    void releaseWorker(String roomName) { }

}
