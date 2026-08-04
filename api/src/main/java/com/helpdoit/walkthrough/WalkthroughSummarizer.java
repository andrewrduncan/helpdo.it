package com.helpdoit.walkthrough;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.helpdoit.ai.AiModels;
import com.helpdoit.ai.ChatModelPort;
import com.helpdoit.ai.ChatPrompt;
import com.helpdoit.ai.MediaPart;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Turns a recorded walkthrough into trainable knowledge: given the question and
 * the captured step sequence, it asks the chat model for (a) a concise prose
 * answer the assistant can give, and (b) a one-line caption per step (used as the
 * on-screen label during guided playback).
 *
 * <p>It reasons over the DOM semantics each step carries — element text, selector,
 * accessibility hints (role/aria/testid), URL transitions — and, when screenshots
 * were captured, the per-step images are attached so a vision model can describe
 * what the user actually sees. If no screenshots exist (capture was off) it falls
 * back cleanly to text-only.
 */
@Service
public class WalkthroughSummarizer {

    private static final Logger log = LoggerFactory.getLogger(WalkthroughSummarizer.class);

    /** Local mapper — the Boot 4 auto-config bean is Jackson 3, not this databind one. */
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String SYSTEM = """
        You are a documentation assistant for an in-app help system. A trainer recorded
        the exact steps to accomplish a task by clicking through the app; you are given
        the question and that ordered step list. Produce a clear, friendly how-to answer
        and a short caption for each step.

        Screenshots captured at each step may be attached, in step order — use them
        to ground the captions and answer in what's actually on screen.

        Respond with ONLY a JSON object, no markdown fences, of the shape:
        {
          "answer": "A concise markdown answer that walks the user through the task, \
        referring to on-screen labels (not selectors). 1 short intro sentence then a \
        numbered list of the steps.",
          "steps": [{"caption": "imperative one-liner", "mode": "auto|input|pick", "prompt": "..."}, ...]
        }

        Rules:
        - steps has exactly one entry per input step, in order.
        - caption: a short imperative instruction describing the user's INTENT in plain \
        language — not a literal echo of UI strings. e.g. "Click the New Order button". \
        Refer to elements by their visible text/label, never CSS selectors.
        - mode tells PLAYBACK how to handle the step for a real (different) user:
            • "auto": deterministic UI that's the same for everyone (buttons, menus, \
        toggles) — playback performs it automatically.
            • "input": the user must enter THEIR OWN data (a search term, name, or value \
        they choose). Playback must PAUSE and let the user type — never reuse the recorded \
        value. Typed-text steps into a search/filter box are almost always "input".
            • "pick": the user must choose among results/list items that differ per user \
        (selecting a search result, an order from a list, a row action like "Start Order" \
        next to their item). Playback highlights the choices and lets the user click one.
        - prompt: for input/pick, a short instruction shown during the pause, e.g. \
        "Type the product you're searching for" or "Click Start Order next to the item you \
        want". For "auto", use "".
        - Dropdowns/menus: a control marked haspopup or role=combobox/listbox OPENS a \
        menu — caption "Open the <name> menu", mode "auto"; the following option step \
        "Choose <option>", mode "auto".
        - A search/filter box (long placeholder like "Search by Alpha, Customer Name…"): \
        the click into it is "auto"; the typing step is "input"; the step that selects a \
        result is "pick".
        - If a step is ambiguous, make your best guess; do not ask questions or add \
        commentary outside the JSON.
        """;

    private final ChatModelPort chat;
    private final AiModels models;

    public WalkthroughSummarizer(ChatModelPort chat, AiModels models) {
        this.chat = chat;
        this.models = models;
    }

    /**
     * The model's output: a prose answer plus, per step (by index), a caption and a
     * playback {@code mode} ({@code auto} | {@code input} | {@code pick}) with an
     * optional user-facing {@code prompt} for the interactive (input/pick) steps.
     */
    public record Summary(String answer, List<String> captions, List<String> modes, List<String> prompts) {}

    /**
     * Rewrite just the prose answer from the trainer's (edited) step captions — used by
     * the review editor's "Regenerate answer" after they reword/reorder/delete steps.
     * The captions are authoritative; this only reflows them into a readable answer.
     * Best-effort: falls back to a numbered list of the captions on any AI failure.
     */
    public String answerFromSteps(String question, ArrayNode steps) {
        List<String> labels = new ArrayList<>();
        for (JsonNode s : steps) {
            String cap = s.path("caption").asText("").trim();
            if (cap.isBlank()) {
                JsonNode t = s.path("target");
                cap = firstNonBlank(t.path("name").asText(""), t.path("text").asText(""));
            }
            if (!cap.isBlank()) {
                labels.add(cap);
            }
        }
        String list = String.join("\n", labels.stream().map(c -> "- " + c).toList());
        try {
            String answer = chat.complete(new ChatPrompt(
                "Write a concise, friendly how-to answer from the ordered steps. Return ONLY the "
                    + "answer text (a one-sentence intro then a numbered list). No preamble or commentary.",
                "Question: " + (question == null ? "(none)" : question.trim()) + "\n\nSteps:\n" + list),
                models.fast());
            if (answer != null && !answer.isBlank()) {
                return answer.trim();
            }
        } catch (Exception e) {
            log.warn("Re-summarize failed; using a plain numbered list", e);
        }
        StringBuilder sb = new StringBuilder("Follow these steps:\n\n");
        for (int i = 0; i < labels.size(); i++) {
            sb.append(i + 1).append(". ").append(labels.get(i)).append('\n');
        }
        return sb.toString().trim();
    }

    /**
     * Summarize the steps into an answer + per-step captions. Best-effort: on any
     * AI/parse failure, falls back to a plain answer built from the step digest so
     * Stop never hard-fails (the trainer can still edit later via retrain).
     */
    public Summary summarize(String question, ArrayNode steps, List<MediaPart> screenshots) {
        String digest = digest(steps);
        List<MediaPart> shots = screenshots == null ? List.of() : screenshots;
        String user = "Question: " + (question == null ? "(none)" : question.trim())
            + "\n\nSteps (" + steps.size() + "):\n" + digest
            + (shots.isEmpty() ? "" : "\n\n" + shots.size() + " screenshot(s) attached in step order.");

        String raw;
        try {
            // Summarization (with screenshots) is quality-sensitive and off the ask path → smart model.
            raw = chat.complete(new ChatPrompt(SYSTEM, user), shots, models.smart());
        } catch (Exception e) {
            log.warn("Summarize failed; using fallback answer", e);
            return fallback(steps, digest);
        }

        try {
            JsonNode root = MAPPER.readTree(stripFences(raw));
            String answer = root.path("answer").asText("").trim();
            if (answer.isEmpty()) {
                return fallback(steps, digest);
            }
            List<String> captions = new ArrayList<>();
            List<String> modes = new ArrayList<>();
            List<String> prompts = new ArrayList<>();
            JsonNode stepHints = root.path("steps");
            if (stepHints.isArray()) {
                for (JsonNode h : stepHints) {
                    captions.add(h.path("caption").asText(""));
                    modes.add(normalizeMode(h.path("mode").asText("auto")));
                    prompts.add(h.path("prompt").asText(""));
                }
            } else {
                // Back-compat: older {"captions":[...]} shape, all auto.
                root.path("captions").forEach(c -> {
                    captions.add(c.asText(""));
                    modes.add("auto");
                    prompts.add("");
                });
            }
            return new Summary(answer, captions, modes, prompts);
        } catch (Exception e) {
            log.warn("Could not parse summarize response: {}", raw, e);
            return fallback(steps, digest);
        }
    }

    /** Coerce the model's mode to one of auto|input|pick (default auto). */
    private static String normalizeMode(String m) {
        String v = m == null ? "" : m.trim().toLowerCase();
        return (v.equals("input") || v.equals("pick")) ? v : "auto";
    }

    /** A readable one-line-per-step rendering fed to the model (and the fallback). */
    private static String digest(ArrayNode steps) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < steps.size(); i++) {
            JsonNode s = steps.get(i);
            String type = s.path("type").asText("click");
            JsonNode t = s.path("target");
            String label = firstNonBlank(t.path("name").asText(""), t.path("text").asText(""));
            String hint = describeHint(t.path("hierarchy"));
            sb.append(i).append(". ");
            switch (type) {
                case "navigate" -> sb.append("Navigate to ").append(s.path("url").asText(""));
                case "input" -> sb.append("Type \"").append(s.path("value").asText(""))
                    .append("\" into ").append(label.isBlank() ? "the field" : "\"" + label + "\"");
                case "select" -> sb.append("Choose \"").append(s.path("label").asText(s.path("value").asText("")))
                    .append("\" from ").append(label.isBlank() ? "the dropdown" : "\"" + label + "\"");
                case "toggle" -> sb.append(s.path("value").asBoolean() ? "Check" : "Uncheck")
                    .append(' ').append(label.isBlank() ? "the option" : "\"" + label + "\"");
                case "rightClick" -> sb.append("Right-click ").append(quoted(label));
                default -> sb.append("Click ").append(quoted(label));
            }
            if (!hint.isBlank() && !"navigate".equals(type)) {
                sb.append(" (").append(hint).append(')');
            }
            sb.append('\n');
        }
        return sb.toString();
    }

    private static String quoted(String label) {
        return label.isBlank() ? "an element" : "\"" + label + "\"";
    }

    private static String firstNonBlank(String a, String b) {
        return a != null && !a.isBlank() ? a : (b == null ? "" : b);
    }

    /** Pull the most useful a11y hint off the clicked element (role/aria/testid/tag). */
    private static String describeHint(JsonNode hierarchy) {
        if (!hierarchy.isArray() || hierarchy.isEmpty()) {
            return "";
        }
        JsonNode el = hierarchy.get(0);
        List<String> bits = new ArrayList<>();
        if (el.hasNonNull("role")) bits.add("role=" + el.get("role").asText());
        if (el.hasNonNull("haspopup")) bits.add("opens-menu");
        if (el.hasNonNull("placeholder")) bits.add("placeholder=\"" + el.get("placeholder").asText() + "\"");
        if (el.hasNonNull("aria")) bits.add("aria=" + el.get("aria").asText());
        if (el.hasNonNull("testid")) bits.add("testid=" + el.get("testid").asText());
        if (bits.isEmpty() && el.hasNonNull("tag")) bits.add("<" + el.get("tag").asText() + ">");
        return String.join(" ", bits);
    }

    /** Plain answer when the model is unavailable — better than failing Stop. Heuristic
     *  modes: typed-text steps become "input" (ask the user), everything else "auto". */
    private static Summary fallback(ArrayNode steps, String digest) {
        StringBuilder answer = new StringBuilder("Follow these steps:\n\n");
        List<String> captions = new ArrayList<>();
        List<String> modes = new ArrayList<>();
        List<String> prompts = new ArrayList<>();
        for (int i = 0; i < steps.size(); i++) {
            JsonNode s = steps.get(i);
            JsonNode t = s.path("target");
            String label = firstNonBlank(t.path("name").asText(""), t.path("text").asText(""));
            String type = s.path("type").asText("click");
            String cap = switch (type) {
                case "navigate" -> "Go to " + s.path("url").asText("the next page");
                case "input" -> "Enter your value" + (label.isBlank() ? "" : " in \"" + label + "\"");
                case "select" -> "Choose \"" + s.path("label").asText(s.path("value").asText("")) + "\"";
                case "toggle" -> (s.path("value").asBoolean() ? "Check" : "Uncheck")
                    + (label.isBlank() ? " the option" : " \"" + label + "\"");
                default -> label.isBlank() ? "Click the highlighted element" : "Click \"" + label + "\"";
            };
            captions.add(cap);
            modes.add("input".equals(type) ? "input" : "auto");
            prompts.add("input".equals(type) ? "Enter your value" : "");
            answer.append(i + 1).append(". ").append(cap).append('\n');
        }
        return new Summary(answer.toString().trim(), captions, modes, prompts);
    }

    /** Models sometimes wrap JSON in ```...``` despite instructions — peel it. */
    private static String stripFences(String s) {
        if (s == null) {
            return "{}";
        }
        String t = s.trim();
        int open = t.indexOf('{');
        int close = t.lastIndexOf('}');
        if (open >= 0 && close > open) {
            return t.substring(open, close + 1);
        }
        return t;
    }
}
