package com.helpdoit.ai;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

import java.util.Arrays;

/**
 * The AI chat providers helpdo.it can talk to. A closed type so a bad provider
 * name can never reach the router — an unknown value fails at the API boundary
 * (deserialization → 400), not deep in the call.
 *
 * <p>Note: {@code OPENAI} is the OpenAI-compatible API; today it's pointed at
 * OpenRouter via {@code spring.ai.openai.base-url}.
 */
public enum Provider {
    OPENAI,
    ANTHROPIC,
    OLLAMA;

    /** The wire form the front end sends (case-insensitive on the way in). */
    @JsonValue
    public String code() {
        return name().toLowerCase();
    }

    @JsonCreator
    public static Provider fromCode(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        for (Provider p : values()) {
            if (p.name().equalsIgnoreCase(value)) {
                return p;
            }
        }
        throw new IllegalArgumentException(
            "Unknown AI provider '" + value + "'. Valid values: " + Arrays.toString(values()));
    }
}
