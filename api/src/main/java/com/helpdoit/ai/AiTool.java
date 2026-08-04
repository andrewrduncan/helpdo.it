package com.helpdoit.ai;

import java.util.function.Function;

/**
 * A framework-neutral tool the model may call: a name, a description, a JSON
 * Schema for its arguments, and an invoke function (raw JSON args in → result
 * string out). The Spring AI adapter wraps each one as a {@code ToolCallback};
 * nothing above the adapter touches Spring AI's tool types or {@code @Tool}.
 */
public interface AiTool {

    /** JSON Schema for a tool that takes no arguments. */
    String NO_ARGS_SCHEMA = "{\"type\":\"object\",\"properties\":{}}";

    String name();

    String description();

    /** JSON Schema describing the arguments object. */
    String inputSchema();

    /** Invoke the tool with the model-supplied JSON arguments; return a result string. */
    String call(String argumentsJson);

    /** Build a tool from a lambda — the convenient way for toolkits to declare tools. */
    static AiTool of(String name, String description, String inputSchema, Function<String, String> fn) {
        return new AiTool() {
            @Override public String name() { return name; }
            @Override public String description() { return description; }
            @Override public String inputSchema() { return inputSchema; }
            @Override public String call(String argumentsJson) { return fn.apply(argumentsJson); }
        };
    }
}
