package com.helpdoit.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface UserRoleRepository extends JpaRepository<UserRole, UUID> {
    List<UserRole> findByUserId(UUID userId);
    boolean existsByUserIdAndRoleId(UUID userId, UUID roleId);
    boolean existsByRoleId(UUID roleId);
    void deleteByUserIdAndRoleId(UUID userId, UUID roleId);
}
