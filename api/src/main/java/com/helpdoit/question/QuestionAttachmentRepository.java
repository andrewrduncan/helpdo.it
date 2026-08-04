package com.helpdoit.question;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface QuestionAttachmentRepository extends JpaRepository<QuestionAttachment, UUID> {
    List<QuestionAttachment> findByQuestionIdOrderByCreatedAtAsc(UUID questionId);
}
