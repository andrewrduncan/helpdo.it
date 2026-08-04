package com.helpdoit.tag;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TagRepository extends JpaRepository<Tag, UUID> {
    Optional<Tag> findByNameIgnoreCase(String name);

    /** Type-ahead: tags whose name contains the query, alphabetical, capped. */
    List<Tag> findByNameContainingIgnoreCaseOrderByNameAsc(String query, Limit limit);
}
