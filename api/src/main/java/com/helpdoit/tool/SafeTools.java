package com.helpdoit.tool;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Callable;

/**
 * Wraps a tool body so it ALWAYS returns a JSON string the model can reason
 * about: {@code {"ok":true,"data":...}} or {@code {"ok":false,"error":...}}.
 *
 * <p>This is promptlydo's strongest tool pattern (AgentToolSafeCall): without
 * it, a thrown exception can let the model hallucinate success. Tool methods
 * delegate their body to {@link #call}.
 */
public final class SafeTools {

    private static final Logger log = LoggerFactory.getLogger(SafeTools.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private SafeTools() {}

    public static String call(Callable<Object> body) {
        try {
            return ok(body.call());
        } catch (Exception e) {
            log.warn("Tool call failed: {}", e.toString());
            return error(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        }
    }

    public static String ok(Object data) {
        return write(Map.of("ok", true, "data", data == null ? "" : data));
    }

    public static String error(String message) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", false);
        m.put("error", message);
        return write(m);
    }

    private static String write(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"serialization failed\"}";
        }
    }
}
