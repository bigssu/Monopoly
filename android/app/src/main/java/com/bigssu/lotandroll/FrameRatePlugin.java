package com.bigssu.lotandroll;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the web layer switch the display refresh request live when the "battery saver (30 fps)"
 * setting changes (src/ui/shell/capacitor.ts `setNativeFrameRate`, docs/PERFORMANCE.md).
 *   FrameRate.set({ hz: 30 })  → prefer a 30 Hz display mode
 *   FrameRate.set({ hz: 60 })  → no preference (system default rate)
 */
@CapacitorPlugin(name = "FrameRate")
public class FrameRatePlugin extends Plugin {

  @PluginMethod
  public void set(PluginCall call) {
    Float hz = call.getFloat("hz", 30f);
    final float rate = hz == null ? 30f : hz;
    getActivity().runOnUiThread(() -> {
      if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).setFrameRate(rate);
      call.resolve();
    });
  }
}
