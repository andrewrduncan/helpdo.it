package com.helpdoit.task;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Enqueue work and (for the runner) claim/complete/fail it. */
@Service
public class TaskQueue {

    private static final int LEASE_MINUTES = 5;

    private final TaskRepository tasks;

    public TaskQueue(TaskRepository tasks) {
        this.tasks = tasks;
    }

    @Transactional
    public UUID enqueue(String type, Map<String, Object> payload) {
        TaskRecord t = new TaskRecord();
        t.setType(type);
        t.setPayload(payload);
        return tasks.save(t).getId();
    }

    /** Claim a batch of due tasks, leasing them to this worker (RUNNING). */
    @Transactional
    public List<TaskRecord> claim(int limit) {
        List<TaskRecord> batch = tasks.claimBatch(limit);
        OffsetDateTime lease = OffsetDateTime.now().plusMinutes(LEASE_MINUTES);
        for (TaskRecord t : batch) {
            t.setStatus(TaskStatus.RUNNING);
            t.setLockedUntil(lease);
            t.setAttempts(t.getAttempts() + 1);
        }
        return batch; // flushed on commit
    }

    @Transactional
    public void complete(UUID id, Map<String, Object> result) {
        tasks.findById(id).ifPresent(t -> {
            t.setStatus(TaskStatus.DONE);
            t.setResult(result);
            t.setLockedUntil(null);
        });
    }

    @Transactional
    public void fail(UUID id, String error) {
        tasks.findById(id).ifPresent(t -> {
            t.setStatus(TaskStatus.FAILED);
            t.setError(error);
            t.setLockedUntil(null);
        });
    }
}
