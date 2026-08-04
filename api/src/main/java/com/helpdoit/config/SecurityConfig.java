package com.helpdoit.config;

import com.helpdoit.auth.ClientRedirectCaptureFilter;
import com.helpdoit.auth.OidcLoginSuccessHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestRedirectFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.web.SecurityFilterChain;

import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import com.nimbusds.jose.jwk.source.ImmutableSecret;

/**
 * Two filter chains, cleanly separated:
 *   1) the OIDC login dance (/oauth2/**, /login/**) — session-based, redirects.
 *   2) the API — stateless, validates our app JWT (Bearer); only /api/me requires
 *      auth today so the extension and portal health checks keep working.
 *
 * Login flow: provider → OidcLoginSuccessHandler mints our app JWT → SPA.
 * The same HS256 secret signs (JwtEncoder) and verifies (JwtDecoder) the app JWT.
 */
@Configuration
class SecurityConfig {

    private final byte[] secret;

    SecurityConfig(@Value("${helpdoit.jwt.secret:dev-only-change-me-helpdoit-jwt-signing-secret-0123456789}") String secret) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    @Bean
    @Order(1)
    SecurityFilterChain oauthLoginChain(HttpSecurity http, OidcLoginSuccessHandler successHandler) throws Exception {
        http
            .securityMatcher("/oauth2/**", "/login/**")
            .authorizeHttpRequests(a -> a.anyRequest().permitAll())
            .oauth2Login(o -> o.successHandler(successHandler))
            // capture ?client_redirect= (web portal or extension chromiumapp.org) for the success handler
            .addFilterBefore(new ClientRedirectCaptureFilter(), OAuth2AuthorizationRequestRedirectFilter.class)
            .csrf(csrf -> csrf.disable());
        return http.build();
    }

    @Bean
    @Order(2)
    SecurityFilterChain apiChain(HttpSecurity http, JwtDecoder jwtDecoder) throws Exception {
        http
            .authorizeHttpRequests(a -> a
                .requestMatchers("/api/me").authenticated()
                // Per-user domain enablement is keyed on the JWT subject — require auth.
                .requestMatchers("/api/domains/enabled", "/api/domains/*/enabled").authenticated()
                .anyRequest().permitAll())          // tighten as admin resolvers land
            .oauth2ResourceServer(o -> o.jwt(jwt -> jwt.decoder(jwtDecoder)))
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .csrf(csrf -> csrf.disable()); // token-based API; no cookies to protect
        return http.build();
    }

    @Bean
    JwtEncoder jwtEncoder() {
        return new NimbusJwtEncoder(new ImmutableSecret<>(secret));
    }

    @Bean
    JwtDecoder jwtDecoder() {
        SecretKeySpec key = new SecretKeySpec(secret, "HmacSHA256");
        return NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
    }
}
