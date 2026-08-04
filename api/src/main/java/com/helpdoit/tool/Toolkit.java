package com.helpdoit.tool;

import com.helpdoit.ai.AiTool;

import java.util.List;

/**
 * A named group of tools an agent can call. Building block #3.
 *
 * <p>Distilled from promptlydo's toolkit-by-name model: an agent's
 * {@code AgentDefinition.toolkits} lists names; {@link ToolkitRegistry} resolves
 * them to {@link AiTool}s. Tools are framework-neutral — the chat adapter turns
 * them into the underlying framework's tool type, so toolkits never import
 * Spring AI.
 */
public interface Toolkit {

    /** Unique name agents reference (e.g. "clock", "knowledge"). */
    String name();

    /** The tools this toolkit provides. */
    List<AiTool> tools();
}
