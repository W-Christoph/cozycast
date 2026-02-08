package com.github.vorlent.cozycastserver

import io.micronaut.context.annotation.Factory
import javax.inject.Singleton

import org.kurento.client.KurentoClient


@Factory
class KurentoFactory {
    @Singleton
    KurentoClient kurentoClient() {
        String ip = System.getenv("KURENTO_IP")
        if (!ip || ip.trim().isEmpty()) {
            throw new IllegalStateException("Environment variable KURENTO_IP is missing or empty")
        }
        return KurentoClient.create("ws://${ip}:8888/kurento")
    }
}