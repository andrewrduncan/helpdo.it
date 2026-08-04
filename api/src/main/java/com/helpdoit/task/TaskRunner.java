package com.helpdoit.task;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The loop: every few seconds, claim due tasks and dispatch each to its
 * {@link AgentTask} handler by {@code type}. Broker-free; survives restarts
 * because state lives in the agent_task table.
 */
@Component
public class TaskRunner {

    private static final Logger log = LoggerFactory.getLogger(TaskRunner.class);
    private static final int BATCH = 10;

    private final TaskQueue queue;
    private final Map<String, AgentTask> handlers;

    public TaskRunner(TaskQueue queue, List<AgentTask> handlers) {
        this.queue = queue;
        this.handlers = handlers.stream()
            .collect(Collectors.toMap(AgentTask::type, Function.identity()));
    }

    @Scheduled(fixedDelayString = "${helpdoit.tasks.poll-ms:5000}")
    public void poll() {
        List<TaskRecord> batch = queue.claim(BATCH);
        for (TaskRecord task : batch) {
            AgentTask handler = handlers.get(task.getType());
            if (handler == null) {
                queue.fail(task.getId(), "No handler registered for task type '" + task.getType() + "'");
                continue;
            }
            try {
                handler.execute(new TaskContext(task.getId(), task.getPayload()));
                queue.complete(task.getId(), null);
            } catch (Exception e) {
                log.warn("Task {} ({}) failed: {}", task.getId(), task.getType(), e.toString());
                queue.fail(task.getId(), e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            }
        }
    }
}
