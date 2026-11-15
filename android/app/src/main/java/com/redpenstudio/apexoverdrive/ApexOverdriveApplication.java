package com.redpenstudio.apexoverdrive;

import android.app.Application;
import android.util.Log;
import com.redpenstudio.apexoverdrive.meta.FacebookMetaSdk;

// The app's Application class. Its only job is Meta install / app-open measurement: it starts the
// Meta SDK before the first screen, but only when the consent answer Google UMP stored on an
// earlier launch allows it (local reads only, never waits for the network). Everything else about
// the game starts in MainActivity as before. Never throws into the app start.
public class ApexOverdriveApplication extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            FacebookMetaSdk.attribution(this).onAppCreate();
        } catch (Throwable t) {
            Log.w("ApexMeta", "Meta start skipped", t);
        }
    }
}
