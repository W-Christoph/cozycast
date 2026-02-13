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
                .setInputType(IngressInput.WHIP_INPUT) // CHANGED TO WHIP
                .setName("Worker-${roomName}")
                .setRoomName(roomName)
                .setParticipantIdentity("worker-${roomName}")
                .setEnableTranscoding(false)
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
}