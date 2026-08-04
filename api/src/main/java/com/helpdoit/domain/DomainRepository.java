package com.helpdoit.domain;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DomainRepository extends JpaRepository<Domain, UUID> {

    Optional<Domain> findByHost(String host);

    List<Domain> findByStatusOrderByHostAsc(String status);
}
