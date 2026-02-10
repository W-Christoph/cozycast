package com.github.vorlent.cozycastserver.service

import com.github.vorlent.cozycastserver.*
import jakarta.inject.Singleton
import io.livekit.server.IngressServiceClient
import io.livekit.server.AccessToken
import io.livekit.server.RoomJoin
import io.livekit.server.RoomName
import io.livekit.server.VideoGrant
// Add these imports for the specific grants
import io.livekit.server.RoomCreate
import io.livekit.server.IngressAdmin
import livekit.LivekitIngress.CreateIngressRequest
import livekit.LivekitIngress.IngressInput
import livekit.LivekitIngress.IngressInfo
import retrofit2.Response
import groovy.util.logging.Slf4j

@Slf4j
@Singleton
class LiveKitMediaManager implements MediaManager {

    private final String apiKey = System.getenv('LIVEKIT_API_KEY') ?: "devkey"
    private final String apiSecret = System.getenv('LIVEKIT_API_SECRET') ?: "secret"
    private final String livekitUrl = System.getenv('LIVEKIT_URL') ?: "http://localhost:7880"
    
    private final IngressServiceClient ingressClient = IngressServiceClient.createClient(livekitUrl, apiKey, apiSecret)

    @Override
    WorkerMediaInfo setupWorker(String roomName) {
        try {
            // 1. Build the Ingress request
            CreateIngressRequest request = CreateIngressRequest.newBuilder()
                .setInputType(IngressInput.WHIP_INPUT)
                .setName("Worker-${roomName}")
                .setRoomName(roomName)
                .setParticipantIdentity("worker-${roomName}")
                .setBypassTranscoding(true) 
                .build()

            // 2. Generate an Administrative Token
            AccessToken token = new AccessToken(apiKey, apiSecret)
            token.setIdentity("server-admin")

            // FIX: Instantiate specific grants directly instead of using Map coercion on the sealed VideoGrant class
            token.addGrants(new IngressAdmin(true), new RoomCreate(true))
            
            String authHeader = "Bearer ${token.toJwt()}"

            // 3. Execute the call via the Retrofit service
            Response<IngressInfo> response = ingressClient.service.createIngress(request, authHeader).execute()
            
            if (!response.isSuccessful()) {
                String error = response.errorBody()?.string()
                log.error("LiveKit API error: {}", error)
                throw new RuntimeException("Failed to create ingress: ${error}")
            }

            IngressInfo info = response.body()
            log.info("Created Ingress for room {}: URL={}, Key={}", roomName, info.getUrl(), info.getStreamKey())

            // Return the dynamic URL and Key provided by LiveKit
            return new WorkerMediaInfo(
                whipUrl: info.getUrl(), 
                streamKey: info.getStreamKey()
            )
        } catch (Exception e) {
            log.error("Failed to setup LiveKit Ingress", e)
            throw e
        }
    }

    @Override
    String getPlayerToken(String roomName, String identity, String nickname) {
        AccessToken token = new AccessToken(apiKey, apiSecret)
        token.setIdentity(identity)
        token.setName(nickname)
        token.addGrants(new RoomJoin(true), new RoomName(roomName))
        return token.toJwt()
    }

    @Override
    void processWorkerAnswer(WorkerSession worker, String roomName, String sdp) {
        try {
            if (!worker.whipUrl) {
                log.error("Worker session missing whipUrl for room {}", roomName)
                return
            }

            URL url = new URL(worker.whipUrl)
            log.info("Handshaking with WHIP URL: {}", url)

            HttpURLConnection connection = (HttpURLConnection) url.openConnection()
            connection.setRequestMethod("POST")
            connection.setRequestProperty("Content-Type", "application/sdp")
            connection.setRequestProperty("Authorization", "Bearer ${worker.streamKey}")
            connection.setDoOutput(true)

            connection.outputStream.withWriter { it.write(sdp) }

            if (connection.responseCode in [200, 201]) {
                // Read text ensuring full stream consumption
                String answerSdp = connection.inputStream.newReader('UTF-8').text
                log.info("WHIP Handshake Success. Response Code: {}", connection.responseCode)
                log.info("WHIP Answer SDP Body:\n{}", answerSdp)
        
                String ip = url.host
                int audioPort = -1
                int videoPort = -1
        
                // Regex for IP
                def ipMatcher = answerSdp =~ /c=IN IP4\s+([^\s\r\n]+)/
                if (ipMatcher.find() && ipMatcher[0][1] != "0.0.0.0") {
                    ip = ipMatcher[0][1]
                }
        
                // Regex for Ports (m=audio <port> and m=video <port>)
                def audioMatcher = answerSdp =~ /m=audio\s+(\d+)/
                if (audioMatcher.find()) audioPort = audioMatcher[0][1].toInteger()
        
                def videoMatcher = answerSdp =~ /m=video\s+(\d+)/
                if (videoMatcher.find()) videoPort = videoMatcher[0][1].toInteger()
                
                // NEW: Parse ICE candidates for the real UDP port
                def candidateMatcher = answerSdp =~ /a=candidate:\S+ \d+ udp \d+ [0-9.]+ (\d+) typ host/
                if (candidateMatcher.find()) {
                    int candidatePort = candidateMatcher[0][1].toInteger()
                    // Use the candidate port if the m-line port is invalid (0 or 9)
                    if (audioPort <= 9) audioPort = candidatePort
                    if (videoPort <= 9) videoPort = candidatePort
                }
                
                // Fallback to existing logic if no candidates found (for safety)
                if (videoPort <= 0 && audioPort > 0) videoPort = audioPort
                if (audioPort <= 0 && videoPort > 0) audioPort = videoPort
        
                log.info("Parsed Destination -> IP: {}, Audio: {}, Video: {}", ip, audioPort, videoPort)
        
                if (audioPort > 0 && videoPort > 0) {
                    worker.websocket.sendSync([
                        type: 'sdpOffer',
                        ip: ip,
                        audioPort: audioPort,
                        videoPort: videoPort
                    ])
                } else {
                    log.error("CRITICAL: LiveKit returned an SDP answer with no media ports. Check Ingress logs.")
                }
            }else {
            // Read the error body from the errorStream
            String errorDetail = ""
            try {
                errorDetail = connection.errorStream?.text ?: "No error body"
            } catch (Exception streamEx) {
                errorDetail = "Could not read error stream: ${streamEx.message}"
            }
        
            log.error("WHIP POST failed! Status: {} {}. Details: {} for room {}", 
                      connection.responseCode, 
                      connection.responseMessage, 
                      errorDetail, 
                      roomName)
        }
        } catch (Exception e) {
            log.error("Error in processWorkerAnswer for room {}", roomName, e)
        }
    }

    @Override
    void releaseWorker(String roomName) { }
}