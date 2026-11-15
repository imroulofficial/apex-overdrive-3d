package com.redpenstudio.apexoverdrive;

import android.app.Activity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.redpenstudio.apexoverdrive.meta.FacebookMetaSdk;
import com.redpenstudio.apexoverdrive.meta.MetaAttribution;
import com.redpenstudio.apexoverdrive.meta.MetaConsentPolicy;

// Local bridge between the game and Meta (Facebook) install / app-open measurement. The SDK is
// started natively at app start (ApexOverdriveApplication) when the consent answer stored on an
// earlier launch allows it. sync() re-applies the same rules (meta/MetaConsentPolicy.java) after
// the game's UMP check and after Settings → Ad privacy, so a new or changed choice still applies.
// No purchase or custom event is logged from here.
@CapacitorPlugin(name = "MetaMeasurement")
public class MetaMeasurementPlugin extends Plugin {

    @PluginMethod
    public void sync(PluginCall call) {
        Activity activity = getActivity();
        Runnable work = () -> {
            try {
                MetaAttribution attribution = FacebookMetaSdk.attribution(getContext());
                MetaConsentPolicy.Decision decision = attribution.onConsentUpdated(
                    activity == null ? null : () -> FacebookMetaSdk.catchUpForeground(activity)
                );
                JSObject result = new JSObject();
                result.put("enabled", decision.enabled);
                result.put("running", attribution.isRunning());
                result.put("reason", decision.reason);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Meta consent sync failed", e);
            }
        };
        if (activity != null) activity.runOnUiThread(work);
        else work.run();
    }
}
