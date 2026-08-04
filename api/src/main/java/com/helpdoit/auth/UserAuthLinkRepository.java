package com.helpdoit.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface UserAuthLinkRepository extends JpaRepository<UserAuthLink, UUID> {
    Optional<UserAuthLink> findByProviderAndProviderKey(String provider, String providerKey);
}
