package com.helpdoit.tool;

import com.helpdoit.ai.AiTool;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Resolves toolkit names → the tool objects to hand the chat model. All
 * {@link Toolkit} beans are auto-collected; agents pick by name. Unknown names
 * are logged and skipped rather than failing the turn.
 */
@Component
public class ToolkitRegistry {

    private static final Logger log = LoggerFactory.getLogger(ToolkitRegistry.class);

    private final Map<String, Toolkit> byName;

    public ToolkitRegistry(List<Toolkit> toolkits) {
        this.byName = toolkits.stream()
            .collect(Collectors.toMap(Toolkit::name, Function.identity()));
    }

    /** Flatten the requested toolkits into the neutral tools to hand the chat port. */
    public List<AiTool> resolve(Collection<String> names) {
        List<AiTool> tools = new ArrayList<>();
        for (String name : names) {
            Toolkit toolkit = byName.get(name);
            if (toolkit == null) {
                log.warn("Agent requested unknown toolkit '{}' — skipping", name);
                continue;
            }
            tools.addAll(toolkit.tools());
        }
        return tools;
    }
}
