package com.helpdoit.config;

import graphql.scalars.ExtendedScalars;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.graphql.execution.RuntimeWiringConfigurer;

/**
 * Registers extra scalar types referenced in schema.graphqls.
 * JSON     — for free-form JSONB payloads (page context, screen-capture metadata, ...)
 * DateTime — for OffsetDateTime fields
 */
@Configuration
class GraphqlConfig {

    @Bean
    RuntimeWiringConfigurer extendedScalars() {
        return wiring -> wiring
            .scalar(ExtendedScalars.Json)
            .scalar(ExtendedScalars.DateTime);
    }
}
