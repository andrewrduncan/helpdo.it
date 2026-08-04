package com.helpdoit.ai.spring;

import com.helpdoit.ai.ChatModelPort;
import com.helpdoit.ai.Provider;

/**
 * Pairs a {@link Provider} with its chat port. {@code AiProvidersConfig}
 * publishes one bean per ENABLED provider; the {@code ChatModelRouter} collects
 * them. (These are not {@link ChatModelPort} beans themselves — the router is
 * the sole {@code ChatModelPort} bean, so injection stays unambiguous.)
 */
record ProviderChatPort(Provider provider, ChatModelPort port) {}
