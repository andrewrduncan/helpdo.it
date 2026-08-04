package com.helpdoit.auth;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Resolves/creates the app user for an external (OIDC) identity. */
@Service
public class UserService {

    private final AppUserRepository users;
    private final UserAuthLinkRepository links;

    public UserService(AppUserRepository users, UserAuthLinkRepository links) {
        this.users = users;
        this.links = links;
    }

    /**
     * Upsert by provider identity: reuse the linked user if known; else attach to
     * an existing user with the same email; else create a new user. Provider-neutral.
     */
    @Transactional
    public AppUser upsertFromProvider(String provider, String providerKey, String email, String name) {
        AppUser user = links.findByProviderAndProviderKey(provider, providerKey)
            .map(link -> users.findById(link.getUserId()).orElseThrow())
            .orElseGet(() -> {
                AppUser u = users.findByEmail(email).orElseGet(() -> {
                    AppUser created = new AppUser();
                    created.setEmail(email);
                    created.setName(name);
                    return users.save(created);
                });
                UserAuthLink link = new UserAuthLink();
                link.setUserId(u.getId());
                link.setProvider(provider);
                link.setProviderKey(providerKey);
                links.save(link);
                return u;
            });

        // Backfill/refresh the display name when the provider supplies one — the
        // name is set on create, but accounts created before it was available (or
        // before the provider returned it) would otherwise stay nameless.
        if (name != null && !name.isBlank() && !name.equals(user.getName())) {
            user.setName(name);
            users.save(user);
        }
        return user;
    }
}
