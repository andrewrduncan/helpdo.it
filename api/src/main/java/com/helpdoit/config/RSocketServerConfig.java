package com.helpdoit.config;

import io.rsocket.core.RSocketServer;
import io.rsocket.core.Resume;
import io.rsocket.transport.netty.server.CloseableChannel;
import io.rsocket.transport.netty.server.WebsocketServerTransport;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.rsocket.annotation.support.RSocketMessageHandler;

import java.time.Duration;

/**
 * Stands up a dedicated RSocket-over-WebSocket server (own port, alongside the
 * Tomcat HTTP server on 8080) for the extension's bidirectional channel.
 *
 * <p>We bind it manually instead of using Spring Boot's RSocket auto-config:
 * that only exposes RSocket-over-WebSocket on a reactive (WebFlux) server, and
 * this app is servlet-based. Binding our own {@link WebsocketServerTransport}
 * keeps the blocking stack untouched.
 *
 * <p>Resume is enabled so a dropped connection can reconnect within the session
 * window and replay missed frames (Layer 1); durable run-id + idempotency
 * (Layer 2) handle longer outages / restarts — added with the agent loop.
 */
@Configuration
class RSocketServerConfig {

    private CloseableChannel channel;

    @Bean
    CloseableChannel rSocketWebSocketServer(
            RSocketMessageHandler messageHandler,
            @Value("${helpdoit.rsocket.port:8081}") int port) {
        this.channel = RSocketServer.create(messageHandler.responder())
            .resume(new Resume()
                .sessionDuration(Duration.ofMinutes(5))   // reconnect window for frame replay
                .cleanupStoreOnKeepAlive())
            .bind(WebsocketServerTransport.create("0.0.0.0", port))
            .block();
        return this.channel;
    }

    /**
     * Release port 8081 SYNCHRONOUSLY on shutdown. {@code dispose()} alone is
     * async — on a DevTools hot-restart the new context would re-bind before the
     * OS frees the socket ("Address already in use"). Blocking on onClose() makes
     * the old context fully release the port before the next bind.
     */
    @PreDestroy
    void shutdown() {
        if (channel != null && !channel.isDisposed()) {
            channel.dispose();
            channel.onClose().block(Duration.ofSeconds(5));
        }
    }
}
