package com.helpdoit.ai.spring;

import com.helpdoit.ai.ChatModelPort;
import com.helpdoit.ai.ChatRequest;
import com.helpdoit.ai.ChatResponse;
import com.helpdoit.ai.Provider;
import com.helpdoit.ai.ProviderSelector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The one {@link ChatModelPort} bean everything injects. Routes each request to
 * the selected provider: an explicit per-request {@link ChatRequest#provider()}
 * wins, else the globally-selected {@link ProviderSelector#current()}. Only
 * enabled providers (those with credentials) are present.
 */
@Component
class ChatModelRouter implements ChatModelPort {

    private static final Logger log = LoggerFactory.getLogger(ChatModelRouter.class);

    private final Map<Provider, ChatModelPort> ports = new EnumMap<>(Provider.class);
    private final ProviderSelector selector;

    ChatModelRouter(List<ProviderChatPort> providers, ProviderSelector selector) {
        this.selector = selector;
        for (ProviderChatPort p : providers) {
            ports.put(p.provider(), p.port());
        }
        log.info("Chat providers enabled: {}", ports.keySet());
    }

    @Override
    public ChatResponse generate(ChatRequest request) {
        Provider provider = request.provider() != null ? request.provider() : selector.current();
        ChatModelPort port = ports.get(provider);
        if (port == null) {
            throw new IllegalStateException(
                "AI provider '" + provider.code() + "' is not enabled. Enabled: " + ports.keySet()
                    + " (set its API key to enable it).");
        }
        return port.generate(request);
    }

    /** Which providers are currently enabled (have credentials). */
    Set<Provider> available() {
        return ports.keySet();
    }
}
