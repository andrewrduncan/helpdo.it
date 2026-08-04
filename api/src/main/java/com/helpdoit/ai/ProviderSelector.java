package com.helpdoit.ai;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicReference;

/**
 * Holds the globally-active chat provider — the "means to swap live". A request
 * can override it per-call ({@link ChatRequest#provider()}); otherwise the
 * router uses {@link #current()}. Mutable at runtime via {@link #use} (e.g. an
 * admin endpoint) with no restart.
 */
@Component
public class ProviderSelector {

    private final AtomicReference<Provider> active;

    public ProviderSelector(@Value("${helpdoit.ai.provider:openai}") String configured) {
        this.active = new AtomicReference<>(Provider.fromCode(configured));
    }

    public Provider current() {
        return active.get();
    }

    public void use(Provider provider) {
        active.set(provider);
    }
}
