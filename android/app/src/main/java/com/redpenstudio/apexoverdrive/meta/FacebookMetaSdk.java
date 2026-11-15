package com.redpenstudio.apexoverdrive.meta;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.appcompat.app.AppCompatActivity;
import androidx.lifecycle.Lifecycle;
import com.facebook.FacebookSdk;
import com.facebook.appevents.AppEventsLogger;
import com.facebook.appevents.internal.ActivityLifecycleTracker;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.UserMessagingPlatform;
import java.util.Map;

/**
 * The Meta (Facebook) SDK core, app events only: no Login, Share, Audience Network or custom
 * events. The App ID and Client Token come from res/values/strings.xml via the manifest. The
 * manifest also removes the SDK's auto-start provider and turns automatic events, advertising-ID
 * collection, screen metadata and diagnostics OFF, so nothing runs or is sent until {@link #enable}.
 * Started the same way as the Zingora game (FacebookMetaSdk.kt).
 */
public final class FacebookMetaSdk implements MetaAttribution.Sdk {

    static final String TAG = "ApexMeta";

    private static MetaAttribution instance;

    private final Application app;

    private FacebookMetaSdk(Application app) {
        this.app = app;
    }

    /** The process-wide measurement switch, created on first use (normally Application.onCreate). */
    public static synchronized MetaAttribution attribution(Context context) {
        if (instance == null) {
            Application app = (Application) context.getApplicationContext();
            instance = new MetaAttribution(
                () -> readStoredSignals(app),
                new FacebookMetaSdk(app),
                (message, error) -> Log.w(TAG, message, error)
            );
        }
        return instance;
    }

    @Override
    @SuppressWarnings("deprecation") // sdkInitialize: the documented manual start when auto-init is off
    public void enable() {
        // Allows the SDK's network requests (it starts with auto-init off, so it would refuse them).
        FacebookSdk.fullyInitialize();
        if (!FacebookSdk.isInitialized()) {
            FacebookSdk.sdkInitialize(app);
        }
        // US state privacy laws: Limited Data Use, with Meta geolocating the device (country 0, state 0).
        FacebookSdk.setDataProcessingOptions(new String[] { "LDU" }, 0, 0);
        FacebookSdk.setAdvertiserIDCollectionEnabled(true);
        FacebookSdk.setAutoInitEnabled(true);
        FacebookSdk.setAutoLogAppEventsEnabled(true);
        // Sends the one-time install event and starts the automatic app-open (activate) events.
        AppEventsLogger.activateApp(app);
    }

    @Override
    public void disable() {
        FacebookSdk.setAutoLogAppEventsEnabled(false);
        FacebookSdk.setAdvertiserIDCollectionEnabled(false);
        FacebookSdk.setAutoInitEnabled(false);
    }

    /**
     * Only when the SDK first starts after MainActivity is already on screen (a fresh install, whose
     * first consent answer arrives during the session): the SDK's lifecycle callbacks missed this
     * launch, so hand it the current screen the way it would have seen it, so this session's
     * standard app-open event is logged too. An SDK started at app start never needs this.
     */
    public static void catchUpForeground(Activity activity) {
        if (activity instanceof AppCompatActivity
            && ((AppCompatActivity) activity).getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
            ActivityLifecycleTracker.onActivityCreated(activity);
            ActivityLifecycleTracker.onActivityResumed(activity);
        }
    }

    /**
     * Reads the stored privacy answer: UMP's consent status and canRequestAds(), plus the IAB TCF
     * (GDPR) and GPP (US states) values UMP writes to the app's default preferences. Local reads only.
     */
    static MetaConsentPolicy.Signals readStoredSignals(Context context) {
        ConsentInformation info = UserMessagingPlatform.getConsentInformation(context);
        SharedPreferences prefs = context.getSharedPreferences(context.getPackageName() + "_preferences", Context.MODE_PRIVATE);
        Map<String, ?> all = prefs.getAll();
        return new MetaConsentPolicy.Signals(
            toUmpStatus(info.getConsentStatus()),
            info.canRequestAds(),
            toGdprApplies(all.get("IABTCF_gdprApplies")),
            asString(all.get("IABTCF_PurposeConsents")),
            asString(all.get("IABTCF_AddtlConsent")),
            asSid(all.get("IABGPP_GppSID")),
            asString(all.get("IABGPP_HDR_GppString"))
        );
    }

    private static MetaConsentPolicy.UmpStatus toUmpStatus(int status) {
        switch (status) {
            case ConsentInformation.ConsentStatus.REQUIRED:
                return MetaConsentPolicy.UmpStatus.REQUIRED;
            case ConsentInformation.ConsentStatus.NOT_REQUIRED:
                return MetaConsentPolicy.UmpStatus.NOT_REQUIRED;
            case ConsentInformation.ConsentStatus.OBTAINED:
                return MetaConsentPolicy.UmpStatus.OBTAINED;
            default:
                return MetaConsentPolicy.UmpStatus.UNKNOWN;
        }
    }

    private static Boolean toGdprApplies(Object value) {
        if (value instanceof Integer) return ((Integer) value) == 1;
        if (value instanceof Long) return ((Long) value) == 1L;
        if (value instanceof Boolean) return (Boolean) value;
        if (value instanceof String) {
            String s = ((String) value).trim();
            if (s.equals("1")) return true;
            if (s.equals("0")) return false;
        }
        return null;
    }

    private static String asString(Object value) {
        return value instanceof String ? (String) value : null;
    }

    private static String asSid(Object value) {
        if (value instanceof Integer || value instanceof Long) return String.valueOf(value);
        return asString(value);
    }
}
