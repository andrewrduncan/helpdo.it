package com.helpdoit.api;

import org.springframework.boot.SpringBootVersion;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.stereotype.Controller;

/** GraphQL smoke-test resolver: { health { application status } }. */
@Controller
class HealthController {

    @QueryMapping
    Health health() {
        return new Health("helpdoit-api", "ok-" + SpringBootVersion.getVersion());
    }

    record Health(String application, String status) {}
}
