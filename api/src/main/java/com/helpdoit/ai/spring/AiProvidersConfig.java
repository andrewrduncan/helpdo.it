package com.helpdoit.ai.spring;

import com.helpdoit.ai.Provider;
import org.springframework.ai.anthropic.AnthropicChatModel;
import org.springframework.ai.ollama.OllamaChatModel;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Publishes one {@link ProviderChatPort} per ENABLED chat provider. Spring AI
 * autoconfigures all three {@code ChatModel} beans (they build offline), but a
 * provider only joins the router if its credential is actually set — that's the
 * key-driven enablement:
 * <ul>
 *   <li>openai/OpenRouter → {@code OPENROUTER_API_KEY}</li>
 *   <li>anthropic → {@code ANTHROPIC_API_KEY}</li>
 *   <li>ollama (keyless) → {@code HELPDOIT_OLLAMA_ENABLED=true}</li>
 * </ul>
 * Add a provider's key to {@code .env} and it appears in the router on next
 * boot — no code change.
 */
@Configuration
class AiProvidersConfig {

    @Bean
    @ConditionalOnExpression("'${OPENROUTER_API_KEY:}' != ''")
    ProviderChatPort openAiProvider(OpenAiChatModel model) {
        return new ProviderChatPort(Provider.OPENAI, new SpringAiChatAdapter(model));
    }

    @Bean
    @ConditionalOnExpression("'${ANTHROPIC_API_KEY:}' != ''")
    ProviderChatPort anthropicProvider(AnthropicChatModel model) {
        return new ProviderChatPort(Provider.ANTHROPIC, new SpringAiChatAdapter(model));
    }

    @Bean
    @ConditionalOnExpression("${HELPDOIT_OLLAMA_ENABLED:false}")
    ProviderChatPort ollamaProvider(OllamaChatModel model) {
        return new ProviderChatPort(Provider.OLLAMA, new SpringAiChatAdapter(model));
    }
}
