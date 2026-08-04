package com.helpdoit.api;

import org.springframework.boot.SpringBootVersion;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST smoke-test endpoint: GET /api/health.
 *
 * helpdo.it speaks both protocols: REST for the Chrome extension (asking
 * questions, posting screen-capture context, polling answers) and GraphQL for
 * the admin training web interface. This mirrors the GraphQL {@code health}
 * resolver so either client can confirm what's deployed.
 */
@RestController
@RequestMapping("/api")
class HealthRestController {

    @GetMapping("/health")
    Health health() {
        return new Health("helpdoit-api", "ok-" + SpringBootVersion.getVersion());
    }

    record Health(String application, String status) {}
}
