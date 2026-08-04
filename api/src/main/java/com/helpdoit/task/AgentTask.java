package com.helpdoit.task;

/**
 * Handler for one kind of queued task. Implement this (as a Spring bean) and the
 * {@link TaskRunner} dispatches matching rows to {@link #execute}. Building
 * block #5 — kept minimal on purpose; concrete task types come later.
 *
 * <p>(Named {@code AgentTask}, not {@code IAgentTask} — Java drops the {@code I}
 * interface prefix.)
 */
public interface AgentTask {

    /** The {@code agent_task.type} value this handler claims. */
    String type();

    /** Do the work. Throwing marks the task FAILED with the exception message. */
    void execute(TaskContext context);
}
