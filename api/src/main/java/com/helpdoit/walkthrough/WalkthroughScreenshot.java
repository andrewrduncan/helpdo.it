package com.helpdoit.walkthrough;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/** One screenshot for a step of a {@link Walkthrough} (absent when capture is off). */
@Entity
@Table(name = "walkthrough_screenshot")
@Getter
@Setter
public class WalkthroughScreenshot {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "walkthrough_id", nullable = false)
    private UUID walkthroughId;

    @Column(name = "step_index", nullable = false)
    private int stepIndex;

    /** base64 image payload (data-URL body). */
    @Column(nullable = false)
    private String image;

    @Column(name = "content_type", nullable = false)
    private String contentType = "image/jpeg";

    @CreationTimestamp
    @Column(name = "captured_at", nullable = false, updatable = false)
    private OffsetDateTime capturedAt;
}
