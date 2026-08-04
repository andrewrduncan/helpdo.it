package com.helpdoit.domain;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface UserDomainRepository extends JpaRepository<UserDomain, UUID> {

    List<UserDomain> findByUserId(UUID userId);

    boolean existsByUserIdAndDomainId(UUID userId, UUID domainId);

    void deleteByUserIdAndDomainId(UUID userId, UUID domainId);
}
