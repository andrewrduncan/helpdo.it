package com.helpdoit.task;

import java.util.Map;
import java.util.UUID;

/** What a task handler receives: the task id and its decoded payload. */
public record TaskContext(UUID taskId, Map<String, Object> payload) {

    public TaskContext {
        payload = payload == null ? Map.of() : payload;
    }
}
