package com.helpdoit.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface RoleClaimMappingRepository extends JpaRepository<RoleClaimMapping, UUID> {
}
