package com.redpenstudio.apexoverdrive.meta;

/**
 * Switches Meta install / app-open measurement on and off from the stored consent answer
 * ({@link MetaConsentPolicy}), like the Zingora game's MetaAttribution. Nothing here can throw into
 * the game or wait for anything:
 *
 * - {@link #onAppCreate} runs once from Application.onCreate, before any screen, using the answer
 *   UMP stored on an earlier launch. Starting there (Meta's documented place when automatic logging
 *   is off in the manifest) lets the SDK see MainActivity open, so every app open is counted.
 * - {@link #onConsentUpdated} runs after the game's UMP check (ads.init) and after Settings → Ad
 *   privacy, so a new or changed choice still applies in the same session.
 *
 * The SDK is only ever started after a decision says ON. When a decision says OFF, an SDK started
 * earlier in this process is told to stop; one never started stays untouched.
 */
public final class MetaAttribution {

    /** The calls this makes into the Meta SDK. Main thread. */
    public interface Sdk {
        void enable();

        void disable();
    }

    /** Reads the stored privacy answer; may throw (treated as OFF). */
    public interface SignalsSource {
        MetaConsentPolicy.Signals read() throws Exception;
    }

    /** Where failures are reported (Logcat on the device). */
    public interface Log {
        void warn(String message, Throwable error);
    }

    private final SignalsSource signals;
    private final Sdk sdk;
    private final Log log;
    private boolean running = false;
    private boolean everStarted = false;
    private MetaConsentPolicy.Decision last = null;

    public MetaAttribution(SignalsSource signals, Sdk sdk, Log log) {
        this.signals = signals;
        this.sdk = sdk;
        this.log = log;
    }

    /** App start: the answer stored on an earlier launch. */
    public synchronized MetaConsentPolicy.Decision onAppCreate() {
        return apply(null);
    }

    /**
     * After a UMP check or the privacy options form. {@code catchUpForeground} runs only when this
     * call is the first start of the SDK in this process: the game is then already on screen, so
     * the SDK missed this session's app open and is handed the current screen (may be null).
     */
    public synchronized MetaConsentPolicy.Decision onConsentUpdated(Runnable catchUpForeground) {
        return apply(catchUpForeground);
    }

    public synchronized boolean isRunning() {
        return running;
    }

    public synchronized MetaConsentPolicy.Decision lastDecision() {
        return last;
    }

    private MetaConsentPolicy.Decision apply(Runnable catchUpForeground) {
        MetaConsentPolicy.Decision decision;
        try {
            decision = MetaConsentPolicy.decide(signals.read());
        } catch (Throwable t) {
            log.warn("Meta consent could not be read", t);
            decision = new MetaConsentPolicy.Decision(false, "consent unreadable");
        }
        last = decision;
        if (decision.enabled && !running) {
            try {
                sdk.enable();
                running = true;
                boolean firstStart = !everStarted;
                everStarted = true;
                if (firstStart && catchUpForeground != null) catchUpForeground.run();
            } catch (Throwable t) {
                log.warn("Meta SDK not started", t);
            }
        } else if (!decision.enabled && running) {
            try {
                sdk.disable();
            } catch (Throwable t) {
                log.warn("Meta SDK not stopped", t);
            }
            running = false;
        }
        return decision;
    }
}
