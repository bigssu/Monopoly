# Tech stack and Android (Capacitor) research: Vite + TypeScript board game to Google Play

Researched 2026-09-29. Versions were read from the npm registry (`npm view`) and from upstream source files on GitHub raw. Policy dates come from developer.android.com and search results. `support.google.com` (Play Console Help), `capacitorjs.com`, `capawesome.io` and `developer.chrome.com` were blocked by the sandbox egress proxy. Play Console policy details marked (search) therefore come from search-result summaries, not the primary page. Re-verify those in Play Console before submission.

---

## 0. Decisions at a glance

| Topic | Recommendation |
|---|---|
| Wrapper | Capacitor **8.5.2** (Android only; do not add iOS) |
| Node | **22.12+** (Capacitor CLI needs >=22, Vitest 5 needs ^22.12 or ^24, Vite 8 needs ^20.19 or >=22.12) |
| JDK | **21** (Capacitor 8 Android library compiles with `JavaVersion.VERSION_21`) |
| Target/compile SDK | **36** (template default; matches the Play requirement effective 2026-08-31) |
| minSdk | **24** (template default; about 99% device coverage, no reason to raise it) |
| Orientation | `android:screenOrientation="sensorLandscape"` **plus** `android:appCategory="game"` on `<application>`. The game category is the exemption that keeps the lock working on tablets under API 36/37 |
| Fullscreen | Capacitor 8 core `SystemBars` plugin (`hidden: true`) plus a small `MainActivity` re-hide on focus. `@capacitor/status-bar` is mostly redundant on Capacitor 8 / Android 16 |
| SFX | Synthesized Web Audio (oscillator plus noise buffers). Viable, zero assets |
| Haptics | `@capacitor/haptics` (also injects the `VIBRATE` permission) with `navigator.vibrate` as web fallback |
| Save data | `@capacitor/preferences` as the source of truth (SharedPreferences), with a `localStorage` mirror |
| Fonts | Self-host (offline app). Jua for display, Noto Sans KR variable for body, subset to used glyphs |
| CI | `ubuntu-24.04` (pinned, see 5.1), temurin 21, gradle wrapper 8.14.3 |
| Flag | The repo is named "Monopoly". "Monopoly" and its board, tokens and property names are Hasbro trademarks and Play rejects IP-infringing apps. Use an original name, art and property names before any store submission |

---

## 1. Current versions (npm registry, 2026-09-29)

| Package | Latest stable | Notes |
|---|---|---|
| `@capacitor/core` | **8.5.2** | 8.x line; `dist-tags.latest` |
| `@capacitor/cli` | **8.5.2** | engines: node >=22.0.0 |
| `@capacitor/android` | **8.5.2** | peer dep `@capacitor/core ^8.5.0` |
| `@capacitor/screen-orientation` | **8.0.1** | |
| `@capacitor/haptics` | **8.0.2** | peer `@capacitor/core >=8.0.0`; ships `<uses-permission VIBRATE>` |
| `@capacitor/status-bar` | **8.0.3** | |
| `@capacitor/splash-screen` | **8.0.2** | |
| `@capacitor/app` | **8.1.1** | |
| `@capacitor/preferences` | **8.0.1** | (extra) |
| `vite` | **8.3.1** | engines node ^20.19.0 or >=22.12.0 |
| `typescript` | **7.0.2** | dist-tag `latest`; `next` is 7.1.0-dev. Major 7 line, so check that your lint/type tooling supports it |
| `vitest` | **5.0.2** | engines node ^22.12.0, ^24.0.0 or >=26; peer `vite ^6.4 or ^7 or ^8` |
| `@playwright/test` | **1.63.0** | engines node >=20 |

Sources: `npm view <pkg> version|engines|peerDependencies` run 2026-09-29. Fontsource alternatives: `@fontsource/jua` 5.3.0, `@fontsource/black-han-sans` 5.3.0, `@fontsource-variable/noto-sans-kr` 5.3.0, `@fontsource/do-hyeon` 5.3.0, `@fontsource/gowun-dodum` 5.3.0.

### 1.1 Capacitor 8 Android template (tag 8.5.2 and main are identical for these files)

- Android Gradle Plugin: **8.13.0** (`classpath 'com.android.tools.build:gradle:8.13.0'`), google-services 4.4.4. https://raw.githubusercontent.com/ionic-team/capacitor/8.5.2/android-template/build.gradle
- Gradle wrapper: **8.14.3** (`gradle-8.14.3-all.zip`). https://raw.githubusercontent.com/ionic-team/capacitor/8.5.2/android-template/gradle/wrapper/gradle-wrapper.properties
- `variables.gradle`: `minSdkVersion = 24`, `compileSdkVersion = 36`, `targetSdkVersion = 36`, androidx.core 1.17.0, appcompat 1.7.1, activity 1.11.0, fragment 1.8.9, coordinatorlayout 1.3.0, core-splashscreen 1.2.0, webkit 1.14.0, cordova-android 14.0.1. https://raw.githubusercontent.com/ionic-team/capacitor/8.5.2/android-template/variables.gradle
- JDK: the Capacitor Android library sets `sourceCompatibility/targetCompatibility JavaVersion.VERSION_21`, so **JDK 21** is required (AGP 8.13 itself needs 17+). https://raw.githubusercontent.com/ionic-team/capacitor/main/android/capacitor/build.gradle
- Template manifest already has `android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"`, `launchMode="singleTask"`, `allowBackup="true"`, and only the `INTERNET` permission. https://raw.githubusercontent.com/ionic-team/capacitor/main/android-template/app/src/main/AndroidManifest.xml
- Default `AppTheme.NoActionBarLaunch` parent is `Theme.SplashScreen` (androidx core-splashscreen). `MainActivity extends BridgeActivity {}`.

---

## 2. Google Play requirements (as of 2026-09-29)

| Item | Requirement | Source |
|---|---|---|
| Target API for new apps and updates | From **2026-08-31**: target **Android 16 (API 36)** or higher. Existing apps must target API 35+ to stay visible to users on newer Android. Extension to **2026-11-01** can be requested in Play Console. Wear OS / Automotive need 35, TV / XR need 34. Since today is after 2026-08-31, a new app must already target 36 | https://developer.android.com/google/play/requirements/target-sdk |
| Next step | Reports say Google Play will require API 37 from about **August 2027** (secondary sources, not verified against the primary policy page) | https://developer.android.com/blog/posts/prepare-your-app-for-the-resizability-and-orientation-changes-in-android-17 |
| Format | New apps must be published as an **Android App Bundle (.aab)** (rule since August 2021). APKs are only for sideload/testing | Play docs (search) |
| Play App Signing | Mandatory for new apps. You sign the AAB with an **upload key**, Google re-signs with the app signing key it holds. Keep the upload keystore backed up (a lost upload key can be reset via Play support) | https://support.google.com/googleplay/android-developer/answer/9842756 (blocked; from search) |
| 16 KB page size | Apps targeting Android 15+ must support 16 KB pages on 64-bit devices. Official page states **deadline 2027-02-01** for releasing updates. Pure Java/Kotlin apps (all libraries) already comply. AGP >= 8.5.1 and NDK r28+ compile compatible by default. A Capacitor app has no NDK code of its own (WebView is a system component), and it uses AGP 8.13.0, so it complies. Verify with `zipalign -c -P 16 -v 4 app.apk` and Play Console pre-launch report | https://developer.android.com/guide/practices/page-sizes |
| minSdk | Capacitor 8 template = **24**. Commentary puts Android 7 (API 24) at about 99% cumulative coverage. Keep 24 | https://raw.githubusercontent.com/ionic-team/capacitor/main/android-template/variables.gradle |
| New personal developer accounts | Personal accounts created after 2023-11-13 must run a **closed test with at least 12 testers opted in for 14 continuous days** before applying for production access. Organization accounts and older accounts are exempt | https://support.google.com/googleplay/android-developer/answer/14151465 (blocked; from search) |
| Data safety form | Required for **every** app, even if it collects nothing: complete the form and declare "no data collected / no data shared". Must also cover SDKs (Capacitor plugins used here collect nothing) | https://support.google.com/googleplay/android-developer/answer/10787469 (blocked; from search) |
| Privacy policy | Play Console requires a privacy-policy URL for all apps. For an offline game with no data collection, a short static page saying so (no data collected, stored only on-device, no network use, no ads, no third parties) is enough. Host it on GitHub Pages or similar | https://support.google.com/googleplay/android-developer/answer/10144311 (blocked; from search) |
| Other declarations | Content rating (IARC questionnaire), target audience (avoid "under 13" unless you meet Families policy), ads = No, app access = no login, Advertising ID declaration = not used, store listing assets (512x512 icon, 1024x500 feature graphic, phone screenshots, and 7"/10" tablet screenshots for better large-screen visibility) | Play Console (general knowledge, verify) |
| Permissions | Keep the manifest minimal: `INTERNET` from the template can be removed for a fully offline game (Capacitor still runs without it; keep it if you use the dev live-reload server). `VIBRATE` comes from `@capacitor/haptics` | see 6 |

---

## 3. Landscape lock and immersive fullscreen

### 3.1 The important catch: large-screen orientation locks are ignored for non-game apps

- **Android 16 (API 36)**: for apps targeting 36, `android:screenOrientation`, `setRequestedOrientation()`, `resizeableActivity`, min/max aspect ratio are **ignored on displays with smallest width >= 600dp** (tablets, foldables unfolded). Exceptions: **games** (declared with `android:appCategory="game"`), small screens, and users who opt in through aspect-ratio settings. A temporary opt-out property exists (`android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY`). https://developer.android.com/about/versions/16/behavior-changes-16
- **Android 17 (API 37, stable since 2026-06-16)**: the opt-out property is **removed** for apps targeting 37; the game exemption stays, and games are identified by the **manifest `android:appCategory` flag, not the Play Store category**. https://developer.android.com/about/versions/17/changes/ff-restrictions-ignored
- `@capacitor/screen-orientation` README repeats the warning: since targetSdk 36 `lock()` has no effect on large screens on Android 16+, unless the opt-out is present. https://raw.githubusercontent.com/ionic-team/capacitor-plugins/main/screen-orientation/README.md

Therefore: put `android:appCategory="game"` on `<application>`. The plugin `@capacitor/screen-orientation` is then optional; the manifest lock is more robust (no flash of portrait at launch). Still build the layout to survive arbitrary window sizes (multi-window, free-form on Chromebooks/desktop mode) because the exemption is not guaranteed to cover every windowing mode.

### 3.2 AndroidManifest changes

```xml
<application
    android:appCategory="game"
    android:allowBackup="false"
    android:icon="@mipmap/ic_launcher"
    android:roundIcon="@mipmap/ic_launcher_round"
    android:label="@string/app_name"
    android:supportsRtl="true"
    android:theme="@style/AppTheme">

  <activity
      android:name=".MainActivity"
      android:exported="true"
      android:launchMode="singleTask"
      android:screenOrientation="sensorLandscape"
      android:resizeableActivity="true"
      android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
      android:theme="@style/AppTheme.NoActionBarLaunch">
    ...
```

- `landscape` = either landscape but system may follow the sensor policy; `sensorLandscape` = both landscape orientations by sensor even if the user disabled auto-rotate (the usual choice for games); `userLandscape` respects the auto-rotate setting.
- `allowBackup="false"` is recommended (or add backup rules) so an Android auto-restore does not resurrect stale SharedPreferences or WebView data on a new device.
- `resizeableActivity` defaults to true for targetSdk >= 24; stating it is harmless.
- `<supports-screens>` is a legacy element. With targetSdk >= 13 the defaults already allow all screen sizes, so it is **not needed**. Only use it if you want to explicitly restrict.
- Optional belt and braces at runtime: `ScreenOrientation.lock({ orientation: 'landscape' })` from `@capacitor/screen-orientation` 8.0.1.

### 3.3 Fullscreen (hide status and navigation bars)

Capacitor 8 has a **core `SystemBars` plugin** (in `@capacitor/core`, since 8.0.0) with `setStyle`, `show`, `hide` (optionally `bar: SystemBarType.StatusBar | NavigationBar`). Config keys read by its Android implementation: `style` (`DARK|LIGHT|DEFAULT`), `hidden` (boolean), `insetsHandling` (`css` default, `native`, `disable`), `initialViewportFitValueHint`. https://raw.githubusercontent.com/ionic-team/capacitor/main/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java

`capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.boardgame',   // choose once; cannot change after publishing
  appName: 'Board Game',
  webDir: 'dist',
  android: { backgroundColor: '#1b1b2f' },
  // androidScheme defaults to https (origin https://localhost). NEVER change it later:
  // localStorage/IndexedDB are per-origin and would appear wiped.
  plugins: {
    SystemBars: { hidden: true, style: 'DARK', insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
    SplashScreen: { launchAutoHide: false, backgroundColor: '#1b1b2f' }
  }
};
export default config;
```

`SystemBars` uses `WindowInsetsControllerCompat.hide(systemBars())`. Two gaps for a game:

1. Hidden bars come back after the user swipes from an edge, an IME, a dialog or a task switch. Re-hide on focus.
2. Display cutout (notch/punch-hole) in landscape: set the cutout mode to `shortEdges` so the WebView draws behind it, and pad with safe-area insets.

`MainActivity.java`:

```java
package com.example.boardgame;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    hideSystemBars();
  }
  @Override public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideSystemBars();
  }
  private void hideSystemBars() {
    WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    c.hide(WindowInsetsCompat.Type.systemBars());
  }
}
```

`res/values/styles.xml` (add to `AppTheme.NoActionBar` and the launch theme; `windowLayoutInDisplayCutoutMode` is API 27+, so put it in `values-v27` or accept lint):

```xml
<item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
```

Pattern taken from the official immersive guide: https://developer.android.com/develop/ui/views/layout/immersive (`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` gives transient, auto-hiding bars on swipe).

### 3.4 `@capacitor/status-bar` on Android 16

On Capacitor 8 with targetSdk 36 the config options `overlaysWebView` and `backgroundColor` **no longer work** because edge-to-edge is enforced (the opt-out `windowOptOutEdgeToEdgeEnforcement` disappeared in Android 16). `StatusBar.hide()` and `setStyle()` still function. https://raw.githubusercontent.com/ionic-team/capacitor-plugins/main/status-bar/README.md
Conclusion: use core `SystemBars` for hiding; only install `@capacitor/status-bar` if you want its API surface on the web/iOS side (not needed for Android-only).

### 3.5 CSS and WebView caveats (100dvh, safe area)

- The page must opt in with `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`. Without `viewport-fit=cover`, Capacitor's `css` mode applies native padding to the decor view and safe-area vars stay 0.
- `env(safe-area-inset-*)` is trustworthy only on **Android System WebView / Chrome >= 140** (Capacitor's constant `WEBVIEW_VERSION_WITH_SAFE_AREA_FIX = 140`; keyboard fix at 144). For older WebViews Capacitor pads the native view and reports 0. In `css` mode it also injects `--safe-area-inset-top|right|bottom|left` (px) on `:root`. Use both:

```css
:root {
  --sa-t: max(env(safe-area-inset-top, 0px),    var(--safe-area-inset-top, 0px));
  --sa-r: max(env(safe-area-inset-right, 0px),  var(--safe-area-inset-right, 0px));
  --sa-b: max(env(safe-area-inset-bottom, 0px), var(--safe-area-inset-bottom, 0px));
  --sa-l: max(env(safe-area-inset-left, 0px),   var(--safe-area-inset-left, 0px));
}
html, body { height: 100%; margin: 0; overflow: hidden; overscroll-behavior: none; touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
#app { position: fixed; inset: 0; padding: var(--sa-t) var(--sa-r) var(--sa-b) var(--sa-l); }
```

- Prefer `position: fixed; inset: 0` (or `100svh`/`100dvh` with that as fallback) over `100vh`. `dvh/svh/lvh` are supported in WebView since Chromium 108, but with bars hidden `100vh`, `100svh` and `100dvh` are essentially equal; the danger is a transient wrong height while bars animate or the IME shows. Re-measure with a `ResizeObserver` on `document.documentElement` and drive the board scale from the observed size, not from `vh`.
- Compute board scale as `min(availW / boardW, availH / boardH)` and render inside one `<svg viewBox>`.
- Sources: Capacitor `SystemBars.java` (above) and Android's WebView edge-to-edge article https://medium.com/androiddevelopers/make-webviews-edge-to-edge-a6ef319adfac (search result).

---

## 4. Tablet support (10 to 13 inch)

- Play/Android large-screen quality tiers: Tier 3 "Adaptive ready" (runs full screen, not letterboxed, multi-window works), Tier 2 "Adaptive optimized" (layouts for tablet/foldable/desktop, input support), Tier 1 "Adaptive differentiated". Games get their own bullet in each tier. Test on: foldable 841x701dp, 8" tablet 1024x640dp, 10.5" tablet 1280x800dp, 13" Chromebook 1600x900dp. Aim for Tier 2. https://developer.android.com/docs/quality-guidelines/large-screen-app-quality
- Manifest: no `<supports-screens>` needed; `resizeableActivity` true (default). Being a game with `appCategory="game"` keeps the landscape lock.
- Crispness in WebView:
  - Draw the board, tokens, dice and cards as **SVG or CSS**, sized by CSS pixels; the compositor rasterizes at native `devicePixelRatio` (typically 2 to 3 on phones, about 1.5 to 2.5 on tablets, up to 3.5 on some).
  - If any canvas is used (particles, confetti), size the backing store `canvas.width = Math.round(cssW * devicePixelRatio)`, then `ctx.scale(dpr, dpr)`, and re-run on `resize` and on `matchMedia('(resolution: Xdppx)')` changes. Prefer `ResizeObserver` with `devicePixelContentBoxSize` where available (Chromium). Cap DPR at about 2.5 to 3 for low-end GPUs.
  - Avoid scaling a rasterized layer with `transform: scale()` when `will-change: transform` is set (Chromium rasterizes at the pre-scale size and blurs). Set the real size via `viewBox`/CSS width instead, or drop `will-change`.
  - Avoid bitmap sprites scaled up. If raster art is needed, ship 2x and 3x assets and use `image-set()`/`srcset`.
  - Keep `<meta viewport>` without `target-densitydpi`. `initial-scale=1` gives DPR-correct rendering.
  - Wait for `document.fonts.ready` before first measurement of SVG `<text>`.
  - Keep SVG filters (blur, drop-shadow) small; they are the main perf cost on mid-range tablets. Use CSS `filter` on small elements only.
  - Layout: side panels (players, cards, log) in the free tablet width rather than scaling the board past about 900 to 1000 css px; allow board to be centered with generous margin.
- Google's WebView pixel-perfect guidance (https://developer.chrome.com/docs/webview/pixel-perfect, blocked; from search) and https://developer.android.com/develop/ui/views/layout/webapps/targeting describe `devicePixelRatio` as the way to query density in WebView.

---

## 5. GitHub Actions: build the Android app on ubuntu

### 5.1 What is preinstalled on the runner

From the Ubuntu 24.04 image readme (https://raw.githubusercontent.com/actions/runner-images/main/images/ubuntu/Ubuntu2404-Readme.md):

- Android Command Line Tools **12.0** (yes, `cmdline-tools` are present) and Platform-Tools 37.0.1
- Build-tools: 34.0.0, 35.0.0 and 35.0.1, 36.0.0 to 36.1.0, 37.0.0
- Platforms: android-34 through 37.2 (plus 37.2 betas)  -> `compileSdk 36` is available
- NDK: 27.3.13750724 (default), 28.2.13676358, 29.0.14206865 (not needed)
- `ANDROID_HOME` = `/usr/local/lib/android/sdk` (also `ANDROID_SDK_ROOT`)
- Java: default **17.0.20**, with 8, 11, 21 and 25 also installed; Gradle 9.7.1 installed (ignore it, use the project wrapper 8.14.3)

Because platform 36 and build-tools 36.0.0 are present and licences are pre-accepted, no `setup-android` action is needed. Still call `actions/setup-java` for a deterministic JDK 21.

**`ubuntu-latest` warning:** GitHub announced (2026-09-17) that `ubuntu-latest` will migrate from Ubuntu 24.04 to **Ubuntu 26.04 between 2026-10-19 and 2026-11-19**. The readme above is for 24.04. Pin `runs-on: ubuntu-24.04` to keep this workflow reproducible, then test `ubuntu-26.04` deliberately. https://github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration/ and https://github.com/actions/runner-images/issues/14748

Action versions found via `git ls-remote --tags` on 2026-09-29: `actions/checkout` v7 (7.0.1), `actions/setup-java` v6 (6.0.1), `actions/setup-node` v7 (7.0.0), `gradle/actions` v6 (6.4.0; the setup step is `gradle/actions/setup-gradle@v6`), `actions/upload-artifact` v7 (7.0.1). Confirm the floating major tags exist before relying on them, or pin to the exact tags.

### 5.2 Release signing with a base64 keystore secret

One-time locally:

```bash
keytool -genkeypair -v -keystore upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload-keystore.jks > upload-keystore.jks.b64   # paste into the secret; never commit the .jks
```

GitHub repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

Add to `android/app/build.gradle` (inside `android { ... }`, before `buildTypes`), reading from environment so debug builds and forks still work without secrets:

```groovy
    signingConfigs {
        release {
            def ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ksPath) {
                storeFile file(ksPath)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
            if (System.getenv("ANDROID_KEYSTORE_PATH")) { signingConfig signingConfigs.release }
        }
    }
```

Also raise `versionCode` on every upload: `versionCode (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInteger()` (Play rejects duplicates).

### 5.3 Complete example: `.github/workflows/android.yml`

```yaml
name: Android build

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
  workflow_dispatch:

concurrency:
  group: android-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx vitest run
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test

  android:
    needs: test
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    env:
      ANDROID_KEYSTORE_PATH: ${{ runner.temp }}/upload-keystore.jks
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm

      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: '21'

      - uses: gradle/actions/setup-gradle@v6
        with:
          cache-read-only: ${{ github.ref != 'refs/heads/main' }}

      - name: Build web assets
        run: |
          npm ci
          npm run build            # vite build -> dist/
          npx cap sync android     # copies dist/ into android/app/src/main/assets/public

      - name: Debug APK
        working-directory: android
        run: |
          chmod +x gradlew
          ./gradlew assembleDebug --no-daemon --stacktrace

      - uses: actions/upload-artifact@v7
        with:
          name: app-debug-apk
          path: android/app/build/outputs/apk/debug/app-debug.apk
          if-no-files-found: error

      - name: Decode keystore
        if: github.event_name != 'pull_request' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'))
        run: echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > "$ANDROID_KEYSTORE_PATH"

      - name: Signed release bundle (AAB)
        if: github.event_name != 'pull_request' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'))
        working-directory: android
        env:
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: ./gradlew bundleRelease --no-daemon --stacktrace

      - uses: actions/upload-artifact@v7
        if: github.event_name != 'pull_request' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'))
        with:
          name: app-release-aab
          path: android/app/build/outputs/bundle/release/app-release.aab
          if-no-files-found: error

      - name: Remove keystore
        if: always()
        run: rm -f "$ANDROID_KEYSTORE_PATH"
```

Notes:
- Commit the `android/` folder (customized manifest, MainActivity, styles). `npx cap sync android` regenerates `capacitor.build.gradle`, plugin lists and assets.
- Secrets are not exposed to `pull_request` runs from forks, so the release steps are skipped there.
- For a signed APK (sideload testing) use `./gradlew assembleRelease`. Debug APK path: `android/app/build/outputs/apk/debug/app-debug.apk`; AAB path: `android/app/build/outputs/bundle/release/app-release.aab`.
- Optional upload to Play (not researched in depth): a community action such as `r0adkll/upload-google-play` with a service-account JSON secret; first upload of a brand-new app must be done manually in Play Console.

---

## 6. WebView audio, vibration

### 6.1 Web Audio autoplay

- Chromium's autoplay policy: an `AudioContext` created before a user gesture starts `suspended`; `resume()` only succeeds after a gesture. **Android System WebView does not necessarily apply this**: it is governed by `WebSettings.setMediaPlaybackRequiresUserGesture`, and **Capacitor's `Bridge.initWebView()` calls `settings.setMediaPlaybackRequiresUserGesture(false)`**, so an AudioContext normally starts `running` inside a Capacitor app. https://raw.githubusercontent.com/ionic-team/capacitor/main/android/capacitor/src/main/java/com/getcapacitor/Bridge.java
- Still write defensively so the same code works in desktop Chrome and mobile browsers used for development:

```ts
let ctx: AudioContext | null = null;
export function audio(): AudioContext {
  return (ctx ??= new AudioContext({ latencyHint: 'interactive' }));
}
export async function unlockAudio() {
  const c = audio();
  if (c.state !== 'running') await c.resume().catch(() => {});
}
addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void unlockAudio(); });
// Capacitor: import { App } from '@capacitor/app'; App.addListener('resume', unlockAudio);
```

- Android suspends audio when the app goes to background; re-`resume()` on `visibilitychange` and on the `@capacitor/app` `resume` / `appStateChange` event. Mute on `pause` so game music does not play behind other apps.
- Volume follows the media stream; users with the media volume at 0 hear nothing, so show a mute/volume toggle in the UI.

### 6.2 Synthesized SFX is viable (zero assets)

- Supported by every WebView since Chromium 37; oscillators, gain envelopes, biquad filters and noise buffers all work.
- Recipes: dice roll = 8 to 12 short band-passed white-noise bursts with a decaying gain; token step = 150 ms triangle blip with pitch drop; buy/cash = two-tone sine arpeggio; card flip = filtered noise swish; fanfare = short square-wave arpeggio with a gain ADSR.
- Build noise once: `const buf = c.createBuffer(1, c.sampleRate, c.sampleRate)` filled with `Math.random()*2-1`, reuse via `AudioBufferSourceNode`. Pre-render heavier sounds with `OfflineAudioContext` into `AudioBuffer`s at startup to remove per-hit CPU and timing jitter.
- Latency on Android WebView is typically 50 to 150 ms, fine for board-game feedback; not suitable for rhythm games. Schedule with `ctx.currentTime` and keep voices below about 16 at a time; call `disconnect()` on `onended` to allow GC.
- Fallback if synthesized sound feels thin: small Ogg/Opus samples (Android WebView decodes Opus and Vorbis).

### 6.3 Vibration: `navigator.vibrate` vs Capacitor Haptics

- Android WebView supports the W3C Vibration API, but `navigator.vibrate()` needs the `android.permission.VIBRATE` in the manifest and returns `false` until the page has had a user activation (tap). The Capacitor template does not include `VIBRATE`.
- `@capacitor/haptics` 8.0.2 ships a manifest with `<uses-permission android:name="android.permission.VIBRATE" />` (verified from the published npm package) and uses `VibrationEffect` via `VibratorManager`/`Vibrator`. It offers typed `impact({style})`, `notification({type})`, `selectionStart/Changed/End`, and `vibrate({duration})`, and does not depend on web user-activation.
- Recommendation: use `@capacitor/haptics` on device, feature-detect `navigator.vibrate` on the web build:

```ts
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
export const tap = () => Capacitor.isNativePlatform()
  ? Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
  : navigator.vibrate?.(10);
```

- Provide a Settings toggle for haptics and remember the choice. Devices in silent/DND or with system haptics disabled will not vibrate.

---

## 7. Persisting game state offline

- `localStorage` in the Capacitor WebView works (`setDomStorageEnabled(true)` in Bridge) and survives app restarts, but Capacitor's docs classify it as **transient**: the OS/WebView may reclaim it under storage pressure, and it is per origin, so changing `androidScheme`/hostname or `appId` loses it. https://capacitorjs.com/docs/guides/storage (blocked; from search summary)
- `@capacitor/preferences` (8.0.1) is backed by Android `SharedPreferences`: persistent, survives WebView data eviction, async, string values. It is meant for small data (settings, a game save of a few KB to a few hundred KB). Not a database. Web build falls back to `localStorage`. https://capacitorjs.com/docs/apis/preferences (blocked; from search summary)
- Recommendation for this game (one saved match, settings, stats, a few hundred KB at most):
  - Source of truth: `Preferences.set({ key: 'save:v1', value: JSON.stringify(state) })` on every turn end (debounced), plus on `App` `pause` and `visibilitychange:hidden`.
  - Mirror to `localStorage` synchronously for fast boot and for the plain-web dev build; on boot read Preferences first, fall back to localStorage.
  - Version the save schema (`v1`), validate with a type guard, wrap `JSON.parse` in try/catch, keep a `save:v1:prev` backup key.
  - If saves grow (replays, history) move to IndexedDB or a SQLite plugin; not needed here.
- Set `android:allowBackup="false"` or provide `dataExtractionRules` so Google's auto-backup does not restore stale game data onto a different install.

---

## 8. Fonts (Google Fonts CSS API v2, fetched 2026-09-29 with a Chrome 140 user agent)

Request used:

```
GET https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&family=Jua&family=Black+Han+Sans&display=swap
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36
```

Result: HTTP 200, 295 KB of CSS, **423 `@font-face` blocks** (Noto Sans KR 124 at weight 400 plus 124 at 700, Jua 87, Black Han Sans 88), every `src` is `format('woff2')`, and Korean is split by `unicode-range` into numbered subsets. The `fonts.gstatic.com` files download with HTTP 200 (verified for Jua latin: 16,620 bytes and Noto Sans KR latin: 26,004 bytes).

Key facts:

- **Noto Sans KR is variable**. With `wght@400;700` the API returns the *same* woff2 URL for both weights (124 URLs shared), i.e., one variable file per subset. Requesting `wght@100..900` returns `font-weight: 100 900;` with the same URL family (`v39/PbykFmXiEBPT4ITbgNA5Cgm20xz64px_1hVWr0wuPNGmlQNMEfD4.{0..119}.woff2`).
- Korean subset URL pattern: `<base>.{N}.woff2` with N = 0..119 (Noto), 2..119 (Jua, 86 files plus 1 latin), 2..119 (Black Han Sans, 87 files plus 1 latin). Subset **119** of Jua and Black Han Sans is the "most common Hangul syllables" file (range starts `U+20-22, U+27-2a ... U+ac00, U+ace0, U+ae30, U+b2e4 ...`).
- Total size if every subset is bundled: Noto Sans KR about **3.4 MB** (124 variable files), Jua about **853 KB**, Black Han Sans about **574 KB**.
- Base URLs (append `.{N}.woff2`):
  - Jua: `https://fonts.gstatic.com/s/jua/v18/co3KmW9ljjAjdojPCM3T3NGswha8jSmuzy4jzT-N`
  - Black Han Sans: `https://fonts.gstatic.com/s/blackhansans/v24/ea8Aad44WunzF9a-dL6toA8r8nqQSWKmEJKy1nK6J8sYUGdTBHS2osQ`
  - Noto Sans KR: `https://fonts.gstatic.com/s/notosanskr/v39/PbykFmXiEBPT4ITbgNA5Cgm20xz64px_1hVWr0wuPNGmlQNMEfD4`
- Latin subset URLs (no index):
  - Jua: `https://fonts.gstatic.com/s/jua/v18/co3KmW9ljjATdOrY.woff2`
  - Black Han Sans: `https://fonts.gstatic.com/s/blackhansans/v24/ea8Aad44WunzF9a-dL6toA8r8kqSK3U.woff2`
  - Noto Sans KR: `https://fonts.gstatic.com/s/notosanskr/v39/PbykFmXiEBPT4ITbgNA5CgmG0X7t.woff2`
- Other candidates (Do Hyeon, Gowun Dodum) also return valid CSS from the same API (188 `@font-face` blocks for the two together); not expanded here. Recommended pairing for a playful game: **Jua** (rounded, friendly, single weight 400) for titles, dice numbers and buttons plus **Noto Sans KR** for body text; **Black Han Sans** is heavier and better for banners only.

### 8.1 Verbatim `@font-face` blocks (Latin subsets and the common-Hangul subset 119)

```css
/* korean subset 119 */
@font-face {
  font-family: 'Jua';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/jua/v18/co3KmW9ljjAjdojPCM3T3NGswha8jSmuzy4jzT-N.119.woff2) format('woff2');
  unicode-range: U+20-22, U+27-2a, U+2c-38, U+3a-3b, U+3f, U+41-47, U+4a-4c, U+4f-5d, U+61-7b, U+7d, U+a1, U+ab, U+ae, U+b7, U+bb, U+bf, U+2013-2014, U+201c-201d, U+2122, U+ac00, U+ace0, U+ae30, U+b2e4, U+b85c, U+b9ac, U+c0ac, U+c2a4, U+c2dc, U+c774, U+c778, U+c9c0, U+d558;
}
/* latin */
@font-face {
  font-family: 'Jua';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/jua/v18/co3KmW9ljjATdOrY.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* korean subset 119 */
@font-face {
  font-family: 'Black Han Sans';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/blackhansans/v24/ea8Aad44WunzF9a-dL6toA8r8nqQSWKmEJKy1nK6J8sYUGdTBHS2osQ.119.woff2) format('woff2');
  unicode-range: U+20-22, U+27-2a, U+2c-38, U+3a-3b, U+3f, U+41-47, U+4a-4c, U+4f-5d, U+61-7b, U+7d, U+a1, U+ab, U+ae, U+b7, U+bb, U+bf, U+2013-2014, U+201c-201d, U+2122, U+ac00, U+ace0, U+ae30, U+b2e4, U+b85c, U+b9ac, U+c0ac, U+c2a4, U+c2dc, U+c774, U+c778, U+c9c0, U+d558;
}
/* latin */
@font-face {
  font-family: 'Black Han Sans';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/blackhansans/v24/ea8Aad44WunzF9a-dL6toA8r8kqSK3U.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* latin */
@font-face {
  font-family: 'Noto Sans KR';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/notosanskr/v39/PbykFmXiEBPT4ITbgNA5CgmG0X7t.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* latin */
@font-face {
  font-family: 'Noto Sans KR';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/notosanskr/v39/PbykFmXiEBPT4ITbgNA5CgmG0X7t.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* korean subset 119 */
@font-face {
  font-family: 'Noto Sans KR';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/notosanskr/v39/PbykFmXiEBPT4ITbgNA5Cgm20xz64px_1hVWr0wuPNGmlQNMEfD4.119.woff2) format('woff2');
  unicode-range: U+20-22, U+27-2a, U+2c-38, U+3a-3b, U+3f, U+41-47, U+4a-4c, U+4f-5d, U+61-7b, U+7d, U+a1, U+ab, U+ae, U+b7, U+bb, U+bf, U+2013-2014, U+201c-201d, U+2122, U+ac00, U+ace0, U+ae30, U+b2e4, U+b85c, U+b9ac, U+c0ac, U+c2a4, U+c2dc, U+c774, U+c778, U+c9c0, U+d558;
}
```

### 8.2 Offline usage guidance

An Android app should not fetch fonts at runtime (the game must work offline, and the CSS API returns different files per user agent). Options:

1. **Fontsource npm packages** (OFL, woff2, same Google subsets, versioned): `@fontsource/jua` 5.3.0 and `@fontsource-variable/noto-sans-kr` 5.3.0. Vite bundles only what you import; import the specific subset CSS files to control size.
2. **Download the woff2 files above** into `src/assets/fonts/` and write your own `@font-face` with the same `unicode-range` values (copy them from the raw CSS).
3. **Best for size**: build a static subset of only the glyphs the game uses (all Korean UI strings, digits, punctuation) with `pyftsubset --text-file=strings.txt --flavor=woff2`. A full game's Korean text is typically a few hundred distinct syllables, so each font ends up at tens of KB instead of megabytes. Keep a `font-family` fallback stack such as `'Jua','Noto Sans KR',system-ui,sans-serif`.

Use `font-display: swap` (or `block` with a short splash) and wait for `document.fonts.ready` (or `document.fonts.load('16px Jua')`) before measuring SVG text. All listed fonts are SIL OFL 1.1 (verify the license file in the Fontsource package you ship).

---

## 9. Source list

- Capacitor Android template: https://raw.githubusercontent.com/ionic-team/capacitor/8.5.2/android-template/build.gradle, `.../variables.gradle`, `.../gradle/wrapper/gradle-wrapper.properties`, `.../app/build.gradle`, `.../app/src/main/AndroidManifest.xml`
- Capacitor Android runtime: https://raw.githubusercontent.com/ionic-team/capacitor/main/android/capacitor/build.gradle, `.../Bridge.java`, `.../plugin/SystemBars.java`, `https://raw.githubusercontent.com/ionic-team/capacitor/main/core/src/core-plugins.ts`
- Capacitor plugins: https://raw.githubusercontent.com/ionic-team/capacitor-plugins/main/status-bar/README.md, `.../screen-orientation/README.md`; `@capacitor/haptics@8.0.2` npm tarball manifest
- Play target API: https://developer.android.com/google/play/requirements/target-sdk
- 16 KB pages: https://developer.android.com/guide/practices/page-sizes
- Android 16 orientation/resizability: https://developer.android.com/about/versions/16/behavior-changes-16
- Android 17 orientation/resizability: https://developer.android.com/about/versions/17/changes/ff-restrictions-ignored and https://developer.android.com/blog/posts/prepare-your-app-for-the-resizability-and-orientation-changes-in-android-17
- Immersive mode: https://developer.android.com/develop/ui/views/layout/immersive
- Large-screen quality: https://developer.android.com/docs/quality-guidelines/large-screen-app-quality
- Runner image: https://raw.githubusercontent.com/actions/runner-images/main/images/ubuntu/Ubuntu2404-Readme.md, https://github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration/, https://github.com/actions/runner-images/issues/14748
- Play Console help (blocked, via search summaries): https://support.google.com/googleplay/android-developer/answer/11926878, /answer/14151465, /answer/10787469, /answer/10144311, /answer/9842756
- Google Fonts CSS API: https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&family=Jua&family=Black+Han+Sans&display=swap
- Capacitor docs (blocked, via search summaries): https://capacitorjs.com/docs/guides/storage, https://capacitorjs.com/docs/apis/preferences

## 10. Open items and risks

1. Trademark: rename the game and replace all Monopoly-specific names, board layout branding and art before publishing (Play IP and impersonation policy).
2. Confirm the Play Console details marked (search) in the live console (12-tester rule applies only to personal accounts created after 2023-11-13).
3. Test the landscape lock on a real 10-inch or larger tablet running Android 16 with `appCategory="game"`; use `adb shell am compat enable UNIVERSAL_RESIZABLE_BY_DEFAULT <pkg>` to simulate the ignore-orientation behavior.
4. Test on an old Android System WebView (< 140) for safe-area handling, and on a device with a display cutout.
5. Decide `appId` and never change `androidScheme` after the first release.
6. TypeScript 7.x and Vitest 5.x are new majors: pin exact versions in `package.json`/lockfile and run `tsc --noEmit` in CI.
