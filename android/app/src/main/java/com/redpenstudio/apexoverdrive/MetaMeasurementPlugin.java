package com.redpenstudio.apexoverdrive;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import androidx.appcompat.app.AppCompatActivity;
import androidx.lifecycle.Lifecycle;
import com.facebook.FacebookSdk;
import com.facebook.appevents.AppEventsLogger;
import com.facebook.appevents.internal.ActivityLifecycleTracker;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Map;

// Local bridge between the game and the Meta (Facebook) SDK, used only for app-install and
// app-open measurement of Meta app ads. It does two things:
//   getConsentSignals  reads the IAB TCF (EU) and GPP (US states) values Google UMP stored
//   setEnabled         starts the SDK with automatic app events + advertiser ID on, or turns
//                      both off again
// The decision itself is made in JavaScript (src/monetization/metaConsent.js, unit tested).
// The SDK's init provider is removed from the manifest, so until setEnabled(true) no Meta code
// runs and nothing is sent to Meta. No purchase or custom event is logged from here.
@CapacitorPlugin(name = "MetaMeasurement")
public class MetaMeasurementPlugin extends Plugin {

    // UMP writes these to the app's default SharedPreferences (IAB TCF v2.2 in-app spec).
    private static final String KEY_GDPR_APPLIES = "IABTCF_gdprApplies";
    private static final String KEY_PURPOSE_CONSENTS = "IABTCF_PurposeConsents";
    private static final String KEY_ADDTL_CONSENT = "IABTCF_AddtlConsent";
    // UMP's US states message writes only these two GPP keys (IAB GPP in-app spec).
    private static final String KEY_GPP_SID = "IABGPP_GppSID";
    private static final String KEY_GPP_STRING = "IABGPP_HDR_GppString";

    // Per process: the SDK can only be started once, even if the plugin is recreated.
    private static boolean started = false;

    @PluginMethod
    public void getConsentSignals(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(context.getPackageName() + "_preferences", Context.MODE_PRIVATE);
        Map<String, ?> all = prefs.getAll();
        JSObject result = new JSObject();
        result.put("gdprApplies", toGdprApplies(all.get(KEY_GDPR_APPLIES)));
        result.put("purposeConsents", toStringOrNull(all.get(KEY_PURPOSE_CONSENTS)));
        result.put("addtlConsent", toStringOrNull(all.get(KEY_ADDTL_CONSENT)));
        Object sid = all.get(KEY_GPP_SID);
        result.put("gppSid", sid instanceof Integer || sid instanceof Long ? String.valueOf(sid) : toStringOrNull(sid));
        result.put("gppString", toStringOrNull(all.get(KEY_GPP_STRING)));
        call.resolve(result);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                if (enabled) start(activity);
                else stop();
                JSObject result = new JSObject();
                result.put("enabled", enabled && started);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Meta SDK " + (enabled ? "start" : "stop") + " failed", e);
            }
        });
    }

    // Consent allows measurement: switches on, then start the SDK once per process.
    @SuppressWarnings("deprecation") // sdkInitialize: the documented manual start when auto-init is off
    private void start(Activity activity) {
        FacebookSdk.setAutoLogAppEventsEnabled(true);
        FacebookSdk.setAdvertiserIDCollectionEnabled(true);
        // Measurement only: no screen titles / AppLink URLs, no "product improvement" data.
        FacebookSdk.setAutoLogMetaDataEnabled(false);
        FacebookSdk.setAutoLogProductImprovementEnabled(false);
        if (started) return;
        // The manifest keeps AutoInitEnabled off; consent is the go-ahead to fully initialise.
        FacebookSdk.fullyInitialize();
        if (!FacebookSdk.isInitialized()) {
            FacebookSdk.sdkInitialize(activity.getApplicationContext());
        }
        started = true;
        // Standard activation: install ping plus automatic activate/deactivate tracking.
        AppEventsLogger.activateApp(activity.getApplication());
        // The SDK starts after MainActivity is already on screen, so its lifecycle callbacks
        // missed this launch. Hand it the current activity the way it would have seen it, so the
        // standard fb_mobile_activate_app event (app open) is logged for this session too.
        if (activity instanceof AppCompatActivity
            && ((AppCompatActivity) activity).getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
            ActivityLifecycleTracker.onActivityCreated(activity);
            ActivityLifecycleTracker.onActivityResumed(activity);
        }
    }

    // Consent withdrawn (or never given). If the SDK was never started nothing is touched;
    // otherwise automatic events and advertiser ID collection stop for the rest of the session.
    // The next launch does not start the SDK at all unless consent allows it again.
    private void stop() {
        if (!started) return;
        FacebookSdk.setAutoLogAppEventsEnabled(false);
        FacebookSdk.setAdvertiserIDCollectionEnabled(false);
    }

    private static Object toGdprApplies(Object value) {
        if (value instanceof Integer) return value;
        if (value instanceof Long) return ((Long) value).intValue();
        if (value instanceof Boolean) return ((Boolean) value) ? 1 : 0;
        if (value instanceof String) {
            String s = ((String) value).trim();
            if (s.equals("1")) return 1;
            if (s.equals("0")) return 0;
        }
        return JSObject.NULL;
    }

    private static Object toStringOrNull(Object value) {
        return value instanceof String ? value : JSObject.NULL;
    }
}
