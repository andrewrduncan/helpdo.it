package com.helpdoit.auth;

import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.List;

/**
 * Mints helpdo.it's OWN app JWT after a successful provider login. This is the
 * single token the rest of the API trusts — provider-agnostic by design (the
 * provider only appears as a claim). HS256, signed with helpdoit.jwt.secret.
 */
@Component
public class AppJwtIssuer {

    private static final Duration TTL = Duration.ofHours(8);

    private final JwtEncoder encoder;

    public AppJwtIssuer(JwtEncoder encoder) {
        this.encoder = encoder;
    }

    public String issue(AppUser user, String provider, String picture, Collection<String> roles) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer("helpdoit")
            .issuedAt(now)
            .expiresAt(now.plus(TTL))
            .subject(user.getId().toString())
            .claim("email", user.getEmail())
            .claim("name", user.getName() == null ? "" : user.getName())
            .claim("picture", picture == null ? "" : picture)
            .claim("provider", provider)
            .claim("roles", roles == null ? List.of() : List.copyOf(roles))
            .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }
}
