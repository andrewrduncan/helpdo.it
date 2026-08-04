package com.helpdoit.api;

import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

/**
 * First RSocket route — a request/response "ping". Whatever the extension sends
 * is acknowledged back, proving the bidirectional channel end to end. An
 * optional base64 image confirms binary payloads ride fine (echoed by size).
 */
@Controller
class PingController {

    @MessageMapping("ping")
    Pong ping(PingRequest request) {
        String text = request == null || request.text() == null ? "" : request.text();
        int imageChars = request == null || request.image() == null ? 0 : request.image().length();
        String message = "pong: received \"" + text + "\""
            + (imageChars > 0 ? " + image (" + imageChars + " base64 chars)" : "");
        return new Pong(true, text, imageChars, message);
    }

    /** image: optional base64 (e.g. a data URL) — proves image payloads work. */
    record PingRequest(String text, String image) {}

    record Pong(boolean received, String echo, int imageChars, String message) {}
}
