package com.helpdoit.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Captures a {@code ?client_redirect=...} on the OAuth authorization request and
 * stashes it in the session so {@link OidcLoginSuccessHandler} can hand the app
 * JWT back to the right client (the web portal, or the browser extension's
 * chromiumapp.org URL for chrome.identity.launchWebAuthFlow). Validated against
 * an allowlist before use — see the success handler.
 */
public class ClientRedirectCaptureFilter extends OncePerRequestFilter {

    static final String SESSION_ATTR = "helpdoit.clientRedirect";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getRequestURI().startsWith("/oauth2/authorization")) {
            String clientRedirect = request.getParameter("client_redirect");
            if (StringUtils.hasText(clientRedirect)) {
                request.getSession(true).setAttribute(SESSION_ATTR, clientRedirect);
            }
        }
        chain.doFilter(request, response);
    }
}
