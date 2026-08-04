package com.helpdoit.question;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface QuestionRepository extends JpaRepository<Question, UUID> {
    List<Question> findAllByOrderByCreatedAtDesc();
    List<Question> findByStatusOrderByCreatedAtDesc(String status);
    List<Question> findByDomainIdOrderByCreatedAtDesc(UUID domainId);
    List<Question> findByDomainIdAndStatusOrderByCreatedAtDesc(UUID domainId, String status);
}
