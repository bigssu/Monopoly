package com.bigssu.lotandroll;

import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Immersive sticky fullscreen for the tabletop game: edge-to-edge, system bars hidden (swipe from an
 * edge shows them transiently) and the screen kept on while playing. Also asks the display for a
 * 30 Hz refresh rate (battery saver, docs/PERFORMANCE.md): the web layer already produces ~30
 * distinct frames per second; panels without a 30 Hz mode simply ignore the request.
 */
public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
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

  /** Prefer 30 Hz (the JS frame budget); the system picks the closest supported mode or ignores it. */
  private void requestLowRefreshRate() {
    WindowManager.LayoutParams lp = getWindow().getAttributes();
    if (lp.preferredRefreshRate != 30f) {
      lp.preferredRefreshRate = 30f;
      getWindow().setAttributes(lp);
    }
  }

  private void hideSystemBars() {
    WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    controller.hide(WindowInsetsCompat.Type.systemBars());
  }
}
