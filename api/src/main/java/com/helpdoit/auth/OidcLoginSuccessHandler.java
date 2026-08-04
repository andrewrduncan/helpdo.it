package com.helpdoit.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.IOException;
import java.net.URI;

/**
 * Runs after a successful OIDC login (any provider): upsert the user, mint our
 * app JWT, and hand it back to the client via a redirect with the token in the
 * URL fragment (kept out of server logs/Referer). The client (web portal or the
 * browser extension) stores it and uses it as a Bearer for the API.
 *
 * <p>Destination = a {@code client_redirect} captured into the session by
 * {@link ClientRedirectCaptureFilter}, validated against an allowlist (the web
 * portal, or any *.chromiumapp.org extension URL); otherwise the portal default.
 */
@Component
public class OidcLoginSuccessHandler implements AuthenticationSuccessHandler {

    private final UserService userService;
    private final RoleService roleService;
    private final AppJwtIssuer jwtIssuer;
    private final String webBaseUrl;

    public OidcLoginSuccessHandler(UserService userService, RoleService roleService, AppJwtIssuer jwtIssuer,
                            @Value("${helpdoit.web.base-url:http://localhost:3000}") String webBaseUrl) {
        this.userService = userService;
        this.roleService = roleService;
        this.jwtIssuer = jwtIssuer;
        this.webBaseUrl = webBaseUrl;
    }

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response,
                                        Authentication authentication) throws IOException {
        OAuth2AuthenticationToken token = (OAuth2AuthenticationToken) authentication;
        String provider = token.getAuthorizedClientRegistrationId(); // e.g. "google"
        OAuth2User principal = token.getPrincipal();

        String providerKey = principal.getName(); // OIDC subject
        String email = principal.getAttribute("email");
        String name = principal.getAttribute("name");
        String picture = principal.getAttribute("picture"); // OIDC profile photo, if provided

        AppUser user = userService.upsertFromProvider(provider, providerKey, email, name);
        roleService.applyClaimMappings(user.getId(), principal.getAttributes());
        roleService.bootstrapAdminIfNone(user.getId()); // first user / lockout safety
        String appJwt = jwtIssuer.issue(user, provider, picture, roleService.rolesFor(user.getId()));

        Object requested = request.getSession().getAttribute(ClientRedirectCaptureFilter.SESSION_ATTR);
        request.getSession().removeAttribute(ClientRedirectCaptureFilter.SESSION_ATTR);

        String redirect = allowed(requested instanceof String s ? s : null)
            ? UriComponentsBuilder.fromUriString((String) requested).fragment("token=" + appJwt).build().toUriString()
            : UriComponentsBuilder.fromUriString(webBaseUrl).path("/auth/callback").fragment("token=" + appJwt).build().toUriString();
        response.sendRedirect(redirect);
    }

    /** Allowlist: the web portal, or any https *.chromiumapp.org extension redirect. */
    private boolean allowed(String clientRedirect) {
        if (clientRedirect == null || clientRedirect.isBlank()) {
            return false;
        }
        if (clientRedirect.startsWith(webBaseUrl)) {
            return true;
        }
        try {
            URI uri = URI.create(clientRedirect);
            return "https".equals(uri.getScheme())
                && uri.getHost() != null
                && uri.getHost().endsWith(".chromiumapp.org");
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
