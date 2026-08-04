package com.helpdoit.task;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface TaskRepository extends JpaRepository<TaskRecord, UUID> {

    /**
     * Claim up to {@code limit} due tasks. {@code FOR UPDATE SKIP LOCKED} lets
     * multiple workers/instances poll concurrently without stepping on each
     * other — the broker-free queue. Call inside a transaction; the caller
     * flips status + lockedUntil before the transaction commits.
     */
    @Query(value = """
        SELECT * FROM agent_task
        WHERE status = 'PENDING'
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY created_at
        LIMIT :limit
        FOR UPDATE SKIP LOCKED
        """, nativeQuery = true)
    List<TaskRecord> claimBatch(@Param("limit") int limit);
}
