package com.redpenstudio.apexoverdrive;

import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

// Edge-to-edge through androidx.activity.EdgeToEdge (the backward-compatible path Google Play
// asks for): it lays the window out behind the system bars and the display cutout on every API
// level, so the app itself never touches the deprecated bar-colour, SYSTEM_UI_FLAG_* or
// cutout-mode APIs. On top of that the bars are hidden for true immersive fullscreen and come
// back only as transient overlays on an edge swipe.
//
// The manifest no longer locks orientation or resizability (large screens, foldables, desktop
// windows and multi-window get any shape and the web layout adapts). Only phone-sized windows
// (smallest width < 600 dp) are held in landscape at runtime, which is what the game is built
// for; Android ignores the request in multi-window mode and on large screens anyway.
public class MainActivity extends BridgeActivity {

    private static final int LARGE_SCREEN_MIN_DP = 600;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        EdgeToEdge.enable(this, SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT));
        applyOrientationPolicy(getResources().getConfiguration());
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setBackgroundColor(Color.BLACK);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(Color.BLACK);
        }
        hideSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }

    // configChanges covers size, orientation and density, so folding, unfolding and window
    // resizes arrive here instead of restarting the activity (and the race).
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyOrientationPolicy(newConfig);
        hideSystemBars();
    }

    // Dialogs, the IME, ads and the Play purchase sheet can bring the bars back; re-hide them
    // whenever the game window regains focus.
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void applyOrientationPolicy(Configuration config) {
        boolean phone = config.smallestScreenWidthDp != Configuration.SMALLEST_SCREEN_WIDTH_DP_UNDEFINED
            && config.smallestScreenWidthDp < LARGE_SCREEN_MIN_DP;
        int wanted = phone && !isInMultiWindowMode()
            ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        if (getRequestedOrientation() != wanted) setRequestedOrientation(wanted);
    }

    private void hideSystemBars() {
        Window window = getWindow();
        View decor = window.getDecorView();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
