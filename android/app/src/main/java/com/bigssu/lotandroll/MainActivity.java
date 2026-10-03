package com.bigssu.lotandroll;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Immersive sticky fullscreen for the tabletop game: edge-to-edge, system bars hidden (swipe from an
 * edge shows them transiently) and the screen kept on while playing. Also asks the display for a
 * 30 Hz refresh rate (battery saver, docs/PERFORMANCE.md): the web layer already produces ~30
 * distinct frames per second. Two hints: the window's preferredRefreshRate (all API levels) and,
 * on Android 15+ (API 35), View#setRequestedFrameRate on the WebView (ARR / frame-rate voting).
 * Displays without a 30 Hz mode (or OEM "game mode" policies) may ignore or override both.
 * The web layer switches it live with the battery-saver setting through {@link FrameRatePlugin}.
 */
public class MainActivity extends BridgeActivity {

  /** Requested presentation rate: 30 (battery saver, the default) or >= 60 = no preference. */
  private float frameRate = 30f;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(FrameRatePlugin.class);
    super.onCreate(savedInstanceState);
    // Match the felt behind web content, including frames before WebView has painted.
    if (getBridge() != null && getBridge().getWebView() != null) {
      getBridge().getWebView().setBackgroundColor(getColor(R.color.table_bg));
    }
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    hideSystemBars();
    requestLowRefreshRate();
  }

  @Override
  public void onResume() {
    super.onResume();
    requestLowRefreshRate();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    // Bars come back after dialogs, task switching and edge swipes: hide them again on every focus gain.
    if (hasFocus) hideSystemBars();
  }

  /** Called by {@link FrameRatePlugin} when the battery-saver setting changes (UI thread). */
  void setFrameRate(float hz) {
    frameRate = hz;
    requestLowRefreshRate();
  }

  /** Prefer 30 Hz (the JS frame budget); the system picks the closest supported mode or ignores it. */
  private void requestLowRefreshRate() {
    boolean low = frameRate > 0f && frameRate < 60f;
    float preferred = low ? frameRate : 0f; // 0 = no preference
    WindowManager.LayoutParams lp = getWindow().getAttributes();
    if (lp.preferredRefreshRate != preferred) {
      lp.preferredRefreshRate = preferred;
      getWindow().setAttributes(lp);
    }
    // Android 15+: per-view frame-rate vote (compileSdk 36; guarded for older devices).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM && getBridge() != null) {
      View webView = getBridge().getWebView();
      if (webView != null) webView.setRequestedFrameRate(low ? frameRate : View.REQUESTED_FRAME_RATE_CATEGORY_DEFAULT);
    }
  }

  private void hideSystemBars() {
    WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    controller.hide(WindowInsetsCompat.Type.systemBars());
  }
}
