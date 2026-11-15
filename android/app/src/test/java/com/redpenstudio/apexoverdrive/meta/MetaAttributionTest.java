package com.redpenstudio.apexoverdrive.meta;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.redpenstudio.apexoverdrive.meta.MetaConsentPolicy.Signals;
import com.redpenstudio.apexoverdrive.meta.MetaConsentPolicy.UmpStatus;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/** Start / stop behaviour: once per ON, never throws into the game (as Zingora's MetaAttributionTest). */
public class MetaAttributionTest {

    private static final Signals ON = new Signals(UmpStatus.NOT_REQUIRED, true, false, null, null, null, null);
    private static final Signals NOT_CHECKED = new Signals(UmpStatus.UNKNOWN, false, null, null, null, null, null);
    private static final Signals REFUSED = new Signals(UmpStatus.REQUIRED, false, true, "0", null, null, null);

    private final List<String> calls = new ArrayList<>();
    private Signals stored = ON;
    private boolean sdkThrows = false;

    private final MetaAttribution attribution = new MetaAttribution(
        () -> stored,
        new MetaAttribution.Sdk() {
            @Override
            public void enable() {
                calls.add("enable");
                if (sdkThrows) throw new IllegalStateException("boom");
            }

            @Override
            public void disable() {
                calls.add("disable");
            }
        },
        (message, error) -> calls.add("warn")
    );

    private final Runnable catchUp = () -> calls.add("catchUp");

    @Test
    public void storedAnswerStartsTheSdkAtAppStartOnceWithoutCatchUp() {
        assertTrue(attribution.onAppCreate().enabled);
        assertTrue(attribution.onConsentUpdated(catchUp).enabled);
        assertTrue(attribution.isRunning());
        assertEquals(List.of("enable"), calls);
    }

    @Test
    public void freshInstallStartsAfterTheFirstCheckAndCatchesUpThisSession() {
        stored = NOT_CHECKED;
        assertFalse(attribution.onAppCreate().enabled);
        assertTrue(calls.isEmpty());
        stored = ON;
        attribution.onConsentUpdated(catchUp);
        attribution.onConsentUpdated(catchUp);
        assertEquals(List.of("enable", "catchUp"), calls);
    }

    @Test
    public void withdrawnConsentStopsAndANewYesRestartsWithoutASecondCatchUp() {
        attribution.onAppCreate();
        stored = REFUSED;
        assertFalse(attribution.onConsentUpdated(catchUp).enabled);
        assertFalse(attribution.isRunning());
        stored = ON;
        attribution.onConsentUpdated(catchUp);
        assertEquals(List.of("enable", "disable", "enable"), calls);
    }

    @Test
    public void neverStartedStaysUntouchedWhenOff() {
        stored = REFUSED;
        attribution.onAppCreate();
        attribution.onConsentUpdated(catchUp);
        assertTrue(calls.isEmpty());
    }

    @Test
    public void failuresNeverReachTheGame() {
        sdkThrows = true;
        assertTrue(attribution.onAppCreate().enabled);
        assertFalse(attribution.isRunning());
        MetaAttribution unreadable = new MetaAttribution(() -> { throw new SecurityException("no prefs"); }, null, (m, e) -> calls.add("warn"));
        assertFalse(unreadable.onAppCreate().enabled);
        assertEquals(List.of("enable", "warn", "warn"), calls);
    }
}
