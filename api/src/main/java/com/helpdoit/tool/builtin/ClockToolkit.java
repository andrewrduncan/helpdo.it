package com.helpdoit.tool.builtin;

import com.helpdoit.ai.AiTool;
import com.helpdoit.tool.SafeTools;
import com.helpdoit.tool.Toolkit;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * Trivial built-in toolkit ("clock") — proves the toolkit → AiTool → SafeTools
 * pattern end to end and gives the seeded "helper" agent something to call.
 * Note: no Spring AI import — tools are framework-neutral.
 */
@Component
public class ClockToolkit implements Toolkit {

    @Override
    public String name() {
        return "clock";
    }

    @Override
    public List<AiTool> tools() {
        return List.of(AiTool.of(
            "current_time",
            "Return the current server date and time in ISO-8601 format.",
            AiTool.NO_ARGS_SCHEMA,
            args -> SafeTools.call(() -> OffsetDateTime.now().toString())
        ));
    }
}
