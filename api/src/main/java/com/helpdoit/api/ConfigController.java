package com.helpdoit.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Public discovery document. The extension/portal is configured with only the
 * instance URL and reads everything else from here: where the RSocket channel
 * lives, which sign-in providers exist, and which sites the widget activates on.
 * Analogous to OIDC's .well-known/openid-configuration.
 */
@RestController
@RequestMapping("/api")
class ConfigController {

    private final String wsUrl;
    private final List<String> enabledSites;
    private final boolean attachmentsEnabled;
    private final ClientRegistrationRepository registrations;

    ConfigController(
            @Value("${helpdoit.config.ws-url:ws://localhost:8081}") String wsUrl,
            @Value("${helpdoit.config.enabled-sites:}") String enabledSitesCsv,
            @Value("${helpdoit.attachments.enabled:true}") boolean attachmentsEnabled,
            ClientRegistrationRepository registrations) {
        this.wsUrl = wsUrl;
        this.enabledSites = Arrays.stream(enabledSitesCsv.split(","))
            .map(String::trim).filter(s -> !s.isEmpty()).toList();
        this.attachmentsEnabled = attachmentsEnabled;
        this.registrations = registrations;
    }

    @GetMapping("/config")
    Config config() {
        List<Provider> providers = new ArrayList<>();
        // InMemoryClientRegistrationRepository is Iterable — list configured providers.
        if (registrations instanceof Iterable<?> iterable) {
            for (Object o : iterable) {
                if (o instanceof ClientRegistration r) {
                    providers.add(new Provider(r.getRegistrationId(), label(r)));
                }
            }
        }
        return new Config(wsUrl, "/oauth2/authorization", providers, enabledSites, attachmentsEnabled);
    }

    private static String label(ClientRegistration r) {
        String name = r.getClientName();
        if (name != null && !name.equals(r.getRegistrationId())) {
            return name;
        }
        String id = r.getRegistrationId();
        return id.isEmpty() ? id : Character.toUpperCase(id.charAt(0)) + id.substring(1);
    }

    record Provider(String id, String label) {}

    record Config(String wsUrl, String authStartPath, List<Provider> providers, List<String> enabledSites,
                  boolean attachmentsEnabled) {}
}
