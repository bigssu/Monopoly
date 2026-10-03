# 릴리스 가이드 — Land Poly (랜드폴리)

Google Play 배포를 위한 빌드, 서명, 버전 관리, Play Console 체크리스트를 정리한 문서입니다.
앱 ID는 기존 설치본의 저장 데이터와 업데이트 경로를 유지하기 위해 `com.bigssu.lotandroll`로 두고, 표시 이름은 `Land Poly`로 사용합니다.
**앱 ID와 `androidScheme`(기본 `https`)은 첫 출시 후 절대 바꾸지 마세요.** 앱 ID를 바꾸면 다른 앱이 되고,
scheme을 바꾸면 저장 데이터(localStorage)의 origin이 달라져 저장된 게임이 사라진 것처럼 보입니다.

> 이 문서의 Play 정책 수치(타깃 API, 12명 테스터 규칙 등)는 2026-09-29 기준 조사 결과입니다
> (`docs/research/03-tech-stack-android-research.md` 참고). Play Console 도움말 페이지는 조사 환경에서
> 직접 열 수 없어 검색 요약에 의존한 항목이 있으니, 제출 직전에 콘솔에서 다시 확인하세요.

---

## 1. 사전 준비

| 항목 | 버전 | 비고 |
|---|---|---|
| Node.js | **22.12 이상** (CI는 22) | Capacitor CLI 8은 Node >= 22 필요 |
| JDK | **21** (Temurin 권장) | Capacitor 8 Android 라이브러리가 Java 21로 컴파일됨 |
| Android Studio | 최신 안정판 (AGP 8.13 지원 버전) | SDK Manager에서 **Android SDK Platform 36**, Build-Tools 36.0.0 설치 |
| Android Gradle Plugin / Gradle | AGP **8.13.0** / Gradle **8.14.3** | Capacitor 8.5 템플릿이 wrapper로 자동 지정 |
| SDK 값 | `minSdk 24`, `compileSdk 36`, `targetSdk 36` | `android/variables.gradle` |

환경 변수 확인:

```bash
node -v            # v22.x
java -version      # openjdk 21
echo $ANDROID_HOME # 예: ~/Android/Sdk  (또는 ANDROID_SDK_ROOT)
```

---

## 2. 로컬 빌드

```bash
npm ci                     # 잠금 파일 기준 의존성 설치
npm run typecheck && npm test
npm run build              # tsc + vite build  ->  dist/
npx cap sync android       # dist/ 를 android/app/src/main/assets/public 으로 복사, 플러그인 동기화
```

`android/` 폴더는 이미 저장소에 커밋되어 있습니다 (Capacitor 8.5 템플릿 + 아래 7장의 수정). 새로 만들 필요가 없으며,
`npx cap add android` 를 다시 실행하면 수정한 매니페스트/`MainActivity`/스타일이 덮어써질 수 있으니 실행하지 마세요.
`android/app/src/main/assets/public/`, `assets/capacitor.config.json`, `assets/capacitor.plugins.json`, `res/xml/config.xml`,
`capacitor-cordova-android-plugins/` 는 `cap sync` 가 매번 생성하는 파일이라 `android/.gitignore` 로 제외되어 있습니다.

### 2.1 Android Studio로 열기

```bash
npx cap open android       # 또는 Android Studio에서 android/ 폴더를 직접 Open
```

Run 버튼으로 에뮬레이터/실기기에 설치합니다. 가로 전용이므로 태블릿 AVD(예: Pixel Tablet, 2560x1600)를 권장합니다.

### 2.2 명령줄로 빌드

```bash
cd android
chmod +x gradlew
./gradlew assembleDebug --no-daemon
# 결과: android/app/build/outputs/apk/debug/LandPoly-debug.apk (앱 표시 이름: Land Poly)

adb install -r app/build/outputs/apk/debug/LandPoly-debug.apk
adb shell am start -n com.bigssu.lotandroll/.MainActivity
```

웹 코드를 고칠 때마다 `npm run build && npx cap sync android` 를 다시 실행해야 앱에 반영됩니다.
기기별 흰 화면 진단에는 `./gradlew clean assembleDebug -PsoftwareWebView=true`로 WebView
소프트웨어 레이어 APK를 만들 수 있습니다. 일반 빌드는 이 옵션 없이 하드웨어 경로를 사용합니다.
두 빌드 모두 Gradle 출력 이름이 `LandPoly-debug.apk`이므로, 소프트웨어판을
`LandPoly-software-debug.apk`로 복사해 보관한 뒤 일반판을 빌드하세요.
두 APK는 같은 앱 ID와 Debug 서명이므로 설치 전에 필요한 진행 상황을 저장하세요.

---

## 3. 업로드 키스토어 만들기

Play App Signing을 쓰므로 여기서 만드는 것은 **업로드 키**입니다 (Google이 최종 앱 서명 키를 따로 보관).
분실하면 Play 지원을 통해 재설정해야 하니 **반드시 백업**(비밀번호 관리자 + 오프라인 사본)하세요.
키스토어와 비밀번호를 저장소에 커밋하면 안 됩니다 (`*.keystore`, `*.jks` 는 `.gitignore` 에 있음).

```bash
keytool -genkeypair -v \
  -keystore upload-keystore.jks \
  -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype PKCS12
```

- 프롬프트에 이름/조직을 입력하고 강력한 비밀번호를 정합니다 (PKCS12에서는 store 비밀번호와 key 비밀번호를 같게 두는 것이 안전합니다).
- 지문 확인: `keytool -list -v -keystore upload-keystore.jks -alias upload`

로컬 서명 빌드용으로 배치:

```bash
cp upload-keystore.jks android/app/release.keystore
```

### 3.1 `android/keystore.properties` 형식

`android/keystore.properties` (저장소 루트 기준 경로) 파일을 만듭니다. **커밋 금지** — `.gitignore` 에
`android/keystore.properties` 항목이 있는지 확인하세요.

```properties
storeFile=release.keystore
storePassword=여기에_스토어_비밀번호
keyAlias=upload
keyPassword=여기에_키_비밀번호
```

- `storeFile` 은 **`android/app/` 기준 상대경로**입니다 (`android/app/release.keystore`).
- 비밀번호에 백슬래시(`\`)가 들어가면 `\\` 로 이스케이프해야 합니다.
- CI(GitHub Actions)는 이 파일과 키스토어를 시크릿에서 자동으로 만듭니다 (6장 참고).

### 3.2 `android/app/build.gradle` 서명 설정 (이미 적용되어 있음)

`android/app/build.gradle` 에는 아래 내용이 **이미 들어 있습니다** (참고용으로 남겨 둠).
`keystore.properties` 가 **있을 때만** 릴리스 서명을 적용합니다.
없으면 서명 없이도 debug 빌드가 그대로 동작합니다. 파일 맨 위 `apply plugin: 'com.android.application'` 바로 아래에:

```groovy
def keystorePropertiesFile = rootProject.file("keystore.properties")   // android/keystore.properties
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.withInputStream { keystoreProperties.load(it) }
}
```

그리고 `android { ... }` 블록 안에서 `buildTypes` 앞에 `signingConfigs`, 그리고 `buildTypes.release` 를 다음과 같이 둡니다.

```groovy
android {
    // ... namespace, compileSdk, defaultConfig 등 기존 내용 ...

    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile     file(keystoreProperties['storeFile'])   // android/app 기준
                storePassword keystoreProperties['storePassword']
                keyAlias      keystoreProperties['keyAlias']
                keyPassword   keystoreProperties['keyPassword']
            }
        }
    }

    buildTypes {
        release {
            minifyEnabled false        // 코드 난독화/축소 끔 (WebView 앱이라 이득이 거의 없음)
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
            if (keystorePropertiesFile.exists()) {
                signingConfig signingConfigs.release
            }
        }
    }
}
```

빌드 확인:

```bash
cd android
./gradlew bundleRelease assembleRelease --no-daemon
# AAB: app/build/outputs/bundle/release/app-release.aab
# APK: app/build/outputs/apk/release/LandPoly-release.apk   (keystore.properties 없으면 서명되지 않음)
```

서명 검증:

```bash
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs app/build/outputs/apk/release/LandPoly-release.apk
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab
```

---

## 4. 버전 관리

Play는 업로드마다 **`versionCode` 가 이전보다 커야** 합니다 (같은 값 거부). `versionName` 은 사용자에게 보이는 문자열입니다.
`android/app/build.gradle` 의 `defaultConfig`:

```groovy
defaultConfig {
    applicationId "com.bigssu.lotandroll"
    minSdkVersion rootProject.ext.minSdkVersion      // 24  (android/variables.gradle)
    targetSdkVersion rootProject.ext.targetSdkVersion // 36
    versionCode 1          // 업로드마다 +1  (정수)
    versionName "0.1.0"    // package.json 의 version 과 맞춤
    // ...
}
```
(현재 값: `versionCode 1`, `versionName "0.1.0"`. `namespace` 도 `com.bigssu.lotandroll`.)

권장 규칙: `versionName = MAJOR.MINOR.PATCH`, `versionCode = MAJOR*10000 + MINOR*100 + PATCH`
(예: 0.1.0 -> `100`, 1.0.0 -> `10000`, 1.2.3 -> `10203`). 같은 버전을 재업로드해야 하면 PATCH를 올립니다.

`package.json` 버전은 `npm version` 으로 올리고(태그·커밋 생성) `build.gradle` 을 맞춰 수정합니다.

```bash
npm version patch          # 0.1.0 -> 0.1.1  (git 태그 v0.1.1 과 커밋을 만듦)
npm version minor          # 0.1.0 -> 0.2.0
npm version 1.0.0          # 지정 버전
npm version patch --no-git-tag-version   # 태그/커밋 없이 파일만 수정
```

선택 사항: `versionName` 을 `package.json` 에서 자동으로 읽으려면 `build.gradle` 상단에

```groovy
def pkg = new groovy.json.JsonSlurper().parse(rootProject.file("../package.json"))
def vParts = pkg.version.tokenize('.').collect { it.toInteger() }
```

를 추가하고 `versionName pkg.version`, `versionCode vParts[0] * 10000 + vParts[1] * 100 + vParts[2]` 로 씁니다.
(`npm version` 만으로 안드로이드 버전이 함께 올라가 실수를 줄여 줍니다.)

---

## 5. AAB 빌드 (Play 업로드용)

신규 앱은 **Android App Bundle(.aab)** 로만 게시할 수 있습니다. APK는 사이드로드/테스트용입니다.

```bash
npm ci && npm run build && npx cap sync android
cd android
./gradlew bundleRelease --no-daemon
# -> android/app/build/outputs/bundle/release/app-release.aab
```

Android Studio에서는 Build > Generate Signed App Bundle / APK 로도 만들 수 있습니다.
CI에서 서명된 AAB/APK를 받는 방법은 6장을 참고하세요.

---

## 6. GitHub Actions

| 워크플로 | 파일 | 트리거 | 하는 일 |
|---|---|---|---|
| CI | `.github/workflows/ci.yml` | push, PR | Node 22, `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, Playwright e2e(실패해도 통과) 후 `e2e/__screenshots__` 업로드 |
| Android | `.github/workflows/android.yml` | push(모든 브랜치), 수동 실행 | JDK 21, `cap sync`, `./gradlew assembleDebug` -> `land-poly-debug-apk` 아티팩트. 시크릿이 모두 있으면 `release` 잡이 `bundleRelease assembleRelease` 후 `app-release-aab`, `land-poly-release-apk` 업로드 |

- `android/` 폴더가 아직 저장소에 없으면 Android 워크플로는 안내 메시지를 출력하고 성공(exit 0)으로 끝납니다.
- 사용한 액션 태그: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/setup-java@v6`,
  `gradle/actions/setup-gradle@v6`, `actions/upload-artifact@v7` (2026-09-29에 `git ls-remote --tags` 로 존재 확인).
- 러너는 `ubuntu-24.04` 로 고정했습니다. `ubuntu-latest` 는 2026-10-19 ~ 11-19 사이 26.04로 넘어갈 예정이라
  재현성을 위해 고정하고, 26.04 전환은 따로 시험하세요. 24.04 이미지에는 Android SDK(플랫폼 36, 빌드툴 36.0.0)가 미리 설치되어 있습니다.

### 6.1 릴리스 서명용 시크릿 설정

저장소 Settings > Secrets and variables > Actions > New repository secret 에 4개를 등록합니다.

| 시크릿 | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 키스토어를 base64 한 줄로 인코딩한 문자열 |
| `ANDROID_KEYSTORE_PASSWORD` | 스토어 비밀번호 |
| `ANDROID_KEY_ALIAS` | 키 별칭 (예: `upload`) |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 |

```bash
base64 -w0 upload-keystore.jks > upload-keystore.jks.b64     # Linux
# macOS:  base64 -i upload-keystore.jks | tr -d '\n' > upload-keystore.jks.b64

# GitHub CLI 로 등록하는 경우
gh secret set ANDROID_KEYSTORE_BASE64 < upload-keystore.jks.b64
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS --body "upload"
gh secret set ANDROID_KEY_PASSWORD

rm upload-keystore.jks.b64     # 인코딩 파일은 사용 후 삭제
```

`release` 잡은 이 값으로 `android/app/release.keystore` 와 `android/keystore.properties`
(`storeFile=release.keystore` 등, 3.1장 형식)를 만들고, 잡이 끝나면 삭제합니다. 4개 중 하나라도 없으면 잡이 건너뛰어지고
debug APK만 빌드됩니다. 포크의 PR에는 GitHub이 시크릿을 전달하지 않습니다.

아티팩트는 Actions 실행 화면 하단 Artifacts 에서 받습니다:
`app-debug-apk`, `app-release-aab`, `app-release-apk`.

---

## 7. 매니페스트: 가로 고정 + 게임 카테고리 + 몰입형 전체 화면

### 7.1 `android/app/src/main/AndroidManifest.xml` (적용 완료)

Android 16(API 36)부터 `targetSdk 36` 앱은 화면 최소 너비가 600dp 이상인 기기(태블릿, 펼친 폴더블)에서
`android:screenOrientation` 등 방향 고정이 **무시됩니다.** 예외가 **게임**이며, 게임 여부는 Play 스토어 카테고리가 아니라
매니페스트의 `android:appCategory="game"` 로 판단합니다 (Android 17에서도 유지). 그래서 `<application>` 에 반드시 넣어야 합니다.

```xml
<supports-screens android:smallScreens="true" android:normalScreens="true"
    android:largeScreens="true" android:xlargeScreens="true" android:anyDensity="true" />

<application
    android:appCategory="game"
    android:allowBackup="false"
    android:hardwareAccelerated="true"
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
    <!-- intent-filter 는 템플릿 그대로 -->
  </activity>
```

- `sensorLandscape`: 사용자가 자동 회전을 꺼도 두 가로 방향을 센서로 허용 (게임에 적합). `landscape` / `userLandscape` 와 구분하세요.
- `allowBackup="false"`: 새 기기에서 오래된 SharedPreferences/WebView 데이터가 자동 복원되는 것을 방지.
- 완전 오프라인 게임이지만 템플릿의 `INTERNET` 권한은 **현재 그대로 남겨 두었습니다** (Capacitor WebView가 `https://localhost` 가상 origin으로
  에셋을 제공하는 데는 필요 없지만, 라이브 리로드 개발 서버를 쓸 때 필요). 개발 서버를 쓰지 않는다면 제거해도 됩니다 — 다만 Play 스토어
  등록정보/데이터 보안 답변("네트워크 사용 안 함")과 맞추려면 출시 전에 제거를 권장합니다.
  `@capacitor/haptics` 가 `VIBRATE` 권한을 자동 추가합니다.
- `<supports-screens>` 는 필수는 아니지만(targetSdk 13 이상은 기본 허용) 태블릿 대상임을 명시하려고 large/xlarge 를 넣어 두었습니다.
- 선택 사항: 런타임에서 `ScreenOrientation.lock({ orientation: 'landscape' })` (`@capacitor/screen-orientation`)로 이중 안전장치.

### 7.2 `capacitor.config.ts` (저장소 루트, 적용 완료)

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bigssu.lotandroll',
  appName: 'Land Poly',
  webDir: 'dist',
  server: { androidScheme: 'https' },            // 절대 바꾸지 말 것 (localStorage origin)
  android: { allowMixedContent: false, backgroundColor: '#1E2A3A' },
  plugins: {
    SplashScreen: { launchAutoHide: false, backgroundColor: '#1E2A3A', showSpinner: false }
  }
};
export default config;
```

- 배경색 `#1E2A3A` 는 앱의 펠트 색(`--felt`)이며 `android/app/src/main/res/values/colors.xml` 의 `table_bg` 와 같은 값입니다.
- `launchAutoHide: false` 라서 스플래시는 웹 쪽이 `SplashScreen.hide()` 를 부를 때까지 유지됩니다 (`src/ui/shell/capacitor.ts` 의 `hideNativeSplash`).
- `SystemBars` 플러그인 설정은 넣지 않았습니다. 시스템 바 숨김은 `MainActivity` 가 네이티브로 처리하고, 인셋은 core 의 `SystemBars`
  기본값(`insetsHandling: 'css'`)이 `--safe-area-inset-*` CSS 변수로 제공합니다.
- `capacitor.config.ts` 는 tsconfig `include` 에 없어서 `npm run typecheck` / vitest 대상이 아닙니다 (Capacitor CLI가 직접 읽음).

### 7.3 몰입형 전체 화면 `MainActivity.java` (적용 완료, Java)

시스템 바는 가장자리 스와이프, 다이얼로그, 작업 전환 뒤에 다시 나타나므로 포커스를 얻을 때마다 다시 숨깁니다.
경로: `android/app/src/main/java/com/bigssu/lotandroll/MainActivity.java`

```java
package com.bigssu.lotandroll;

import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // 플레이 중 화면 켜짐 유지
    hideSystemBars();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideSystemBars();
  }

  private void hideSystemBars() {
    WindowInsetsControllerCompat c =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    c.hide(WindowInsetsCompat.Type.systemBars());
  }
}
```

노치/펀치홀(가로 모드)까지 화면을 채우도록 `android/app/src/main/res/values/styles.xml` 의 `AppTheme.NoActionBar` 와
`AppTheme.NoActionBarLaunch` 에 다음 항목을 넣어 두었습니다 (`values-v27/` 을 따로 만들지 않고 `values/` 에 둠. API 27 미만에서는 무시되고
lint 경고만 납니다).

```xml
<item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
```

같은 파일에서 `AppTheme.NoActionBar` 는 `android:windowBackground` 를 `@color/table_bg` 로 두어 회전/리사이즈 때 흰 깜빡임을 막고,
`AppTheme.NoActionBarLaunch` 는 Android 12+ 시스템 스플래시용 `windowSplashScreenBackground` = `@color/table_bg`,
`windowSplashScreenAnimatedIcon` = `@drawable/splash_icon` 을 지정합니다.

### 7.4 아이콘 / 스플래시 / Play 그래픽 (`scripts/gen-android-icons.mjs`)

모든 런처 아이콘과 스플래시는 사용자 제공 이미지를 256×256으로 축소한 `docs/assets/launcher-mark-256.png`에서 생성합니다 (Playwright + Chromium 필요).
Play 등록용 512px 이미지와 Android 밀도별 리소스는 이 한 장에서 생성합니다. 게임 타이틀 화면은 기존 주사위 그림을 사용합니다.
아이콘의 복장과 출발 칸을 여행복·화살표로 바꿨지만, 스토어 게시 전 사용자 제공 원본 이미지의 사용 권리와 전체 구도의 오인 가능성을 확인해야 합니다.

```bash
node scripts/gen-android-icons.mjs              # Android 리소스 + Play 그래픽 모두
node scripts/gen-android-icons.mjs --no-android # docs/assets 의 Play 그래픽만
```

| 산출물 | 경로 |
|---|---|
| 적응형 아이콘 전경 (108dp) | `android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_foreground.png` (108/162/216/324/432 px) |
| 적응형 아이콘 배경 (흰색) | `android/app/src/main/res/drawable/ic_launcher_background.xml` (스크립트가 생성) |
| 적응형 아이콘 정의 | `res/mipmap-anydpi-v26/ic_launcher{,_round}.xml` (템플릿 파일을 배경 drawable 참조로 수정, 스크립트는 건드리지 않음) |
| 구형 아이콘 (API 24-25) | `res/mipmap-*dpi/ic_launcher.png`, `ic_launcher_round.png` (48-192 px) |
| Android 12+ 스플래시 아이콘 | `res/drawable-nodpi/splash_icon.png` (공용 512×512, 288dp 안전 영역) |
| Android 11 이하 스플래시 | `res/drawable/splash.xml` (단색 배경 + 중앙 288dp 공용 아이콘) |
| Play 아이콘 512x512 | `docs/assets/play-icon-512.png` |
| Play 피처 그래픽 1024x500 (알파 없음) | `docs/assets/feature-graphic-1024x500.png` (Jua 폰트로 렌더링) |

런처 아이콘은 선택한 원본 이미지를 그대로 사용합니다. 앱 시작 화면에는 펠트 배경 위 중앙 안전 영역에 224px 이미지를 배치합니다.

시작 화면만 다시 만들려면 `node scripts/gen-android-icons.mjs --splash-only --no-play`를 실행합니다.
Windows에서는 `CHROMIUM_PATH`로 Chrome을 지정합니다. 생성기는 [Android SplashScreen 안전 영역](https://developer.android.com/reference/androidx/core/splashscreen/SplashScreen)을 픽셀 단위로 검사하며, 이전 밀도/방향별 시작 PNG를 제거합니다.
공용 512px 이미지는 고밀도 기기에서 확대되므로 APK를 설치해 시작 화면의 선명도를 확인해야 합니다.

웹 쪽은 `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`
와 `env(safe-area-inset-*)` / `--safe-area-inset-*` 패딩을 함께 사용합니다.

---

## 8. Play Console 체크리스트 (2026)

### 8.1 빌드/정책 요건

- [ ] **타깃 API 36 이상** (2026-08-31부터 신규 앱과 업데이트에 적용. 필요하면 콘솔에서 2026-11-01까지 연장 신청). `targetSdk 36` 확인.
- [ ] **AAB** 로 업로드 (`app-release.aab`). `versionCode` 는 이전보다 큼.
- [ ] **Play 앱 서명(Play App Signing)** 사용 — 업로드 키로 서명, Google이 최종 서명. 업로드 키스토어 백업 완료.
- [ ] **16 KB 페이지 크기**: 네이티브 코드가 없는 Capacitor 앱 + AGP 8.13 이라 기본 충족. 사전 출시 보고서에서 확인
  (마감: 2027-02-01, 조사 기준).
- [ ] 신규 **개인 개발자 계정**(2023-11-13 이후 생성)은 프로덕션 신청 전에 **비공개 테스트(closed testing)에서
  테스터 12명 이상이 14일 연속 옵트인** 상태를 유지해야 합니다. 조직 계정과 이전 계정은 예외입니다.
  - 테스트 트랙을 만들고 12명 이상의 Google 계정(이메일 또는 Google 그룹)을 추가한 뒤, 옵트인 링크를 공유하세요.
  - 14일이 지나면 콘솔의 "프로덕션 액세스 신청" 설문에 테스트 진행 내용과 피드백 반영을 작성합니다.
- [ ] 앱 이름/설명/키워드에 타사 게임 이름을 쓰지 않음 (`docs/PLAY_LISTING.md` 참고).

### 8.2 앱 콘텐츠 선언

- [ ] **개인정보처리방침 URL** (필수, 모든 앱): `docs/PRIVACY_POLICY.md` 를 공개 URL로 게시하세요.
  예) GitHub Pages 또는 저장소의 raw/blob 링크
  `https://github.com/<계정>/<저장소>/blob/main/docs/PRIVACY_POLICY.md`. 콘솔의 정책 URL과 스토어 등록정보에 동일하게 입력.
- [ ] **데이터 보안(Data safety) 양식** — 데이터를 전혀 수집하지 않아도 제출은 필수:

  | 질문 | 답변 |
  |---|---|
  | 앱이 필수 사용자 데이터 유형을 수집하거나 공유하나요? | **아니요** (수집 안 함, 공유 안 함) |
  | 데이터가 전송 중 암호화되나요? | 해당 없음 (네트워크 사용 안 함) — "수집 안 함" 선택 시 표시되지 않음 |
  | 사용자가 데이터 삭제를 요청할 수 있나요? | 해당 없음 (서버에 데이터 없음. 저장 데이터는 앱 삭제 시 제거됨) |
  | 서드파티 SDK | 없음 (Capacitor 플러그인은 데이터를 수집하지 않음. 광고/분석 SDK 없음) |

  게임 저장·설정은 기기 안(SharedPreferences/WebView 저장소)에만 남고 외부로 전송되지 않습니다.
- [ ] **광고**: 아니요 (광고 없음). **광고 ID**: 사용하지 않음 (`AD_ID` 권한 없음 — 매니페스트에 추가되지 않았는지 확인).
- [ ] **앱 액세스**: 로그인/계정 없음, 모든 기능 제한 없이 이용 가능.
- [ ] **대상 연령**: 13세 미만 아동을 주 대상으로 선택하지 마세요(선택하면 가족 정책 요건이 추가됨). 13세 이상 또는 전 연령 대상으로 신중히 고르세요.
- [ ] **정부 앱 / 금융 기능 / 건강 앱 등**: 모두 해당 없음.
- [ ] **인앱 구매 없음** — 상점 가격 "무료", 앱 내 결제 없음.

### 8.3 콘텐츠 등급 설문 (IARC) 힌트

카테고리는 "게임"을 선택합니다. 각 항목의 권장 답변:

| 항목 | 답변 | 설명 |
|---|---|---|
| 폭력 | 아니요 | 만화적 연출조차 없음, 전투 없음 |
| 성적 콘텐츠 / 노출 | 아니요 | |
| 욕설 | 아니요 | |
| 마약·알코올·담배 | 아니요 | |
| 도박 관련 콘텐츠 | 아니요 | 실제 돈을 걸지 않음 |
| **모의 도박(simulated gambling)** | **아니요** | 슬롯/카드/룰렛 등 배팅·베팅 요소가 전혀 없고, 주사위는 말 이동에만 쓰이며 앱 내 화폐는 승패 점수용 게임 재화일 뿐입니다. 걸고 잃는 구조 자체가 없으므로 "아니요". |
| 사용자 간 상호작용 / 채팅 | 아니요 | 온라인 기능 없음 (한 기기에서 번갈아 플레이) |
| 위치 공유 | 아니요 | |
| 디지털 상품 구매 | 아니요 | 인앱 결제 없음 |
| 사용자 생성 콘텐츠 | 아니요 | 플레이어 이름 입력은 기기 안에서만 사용됨 |

예상 등급: IARC 3+ / ESRB Everyone / PEGI 3 / 대한민국 전체 이용가 수준 (설문 결과에 따름).
게임의 가상 화폐 단위 `만` 은 실제 현금과 교환되지 않는다는 점을 설문 메모에 적어둘 수 있습니다.

### 8.4 스토어 등록정보 & 그래픽

카피와 에셋 목록은 `docs/PLAY_LISTING.md` 를 사용하세요. 요약:

- [ ] 앱 아이콘 512 x 512 PNG (32비트, 최대 1024 KB)
- [ ] 피처 그래픽 1024 x 500 (JPEG 또는 24비트 PNG, 알파 없음)
- [ ] **휴대전화 스크린샷** 최소 2장 (가로 16:9)
- [ ] **7인치 태블릿 스크린샷**, **10인치 태블릿 스크린샷** 각각 등록 — 태블릿 화면에서 노출/추천에 유리하고,
  대화면 앱 품질 평가에도 반영됩니다. 형식은 JPEG 또는 24비트 PNG(알파 없음), 한 변 320~3840 px, 긴 변은 짧은 변의 2배 이하.
  이 게임은 가로 고정이므로 16:10 또는 16:9 가로 이미지를 사용합니다 (예: 2560x1600, 1920x1080). 권장 해상도 및 개수는 콘솔 안내를 다시 확인하세요.
- [ ] 카테고리 **보드(Board)**, 태그 (보드/전략 등), 연락처 이메일 (`sungwooksukr@gmail.com`)

### 8.5 출시 순서 (권장)

1. 내부 테스트 트랙에 AAB 업로드 -> 실기기(가능하면 10인치 이상 Android 16 태블릿)에서 가로 고정, 전체 화면, 저장/이어하기, 오프라인(비행기 모드) 확인.
2. 비공개 테스트 트랙으로 테스터 12명 이상 모집, 14일 유지 (개인 계정일 경우).
3. 사전 출시 보고서(충돌, 접근성, 16 KB 페이지)를 확인.
4. 스토어 등록정보, 앱 콘텐츠 선언(개인정보처리방침, 데이터 보안, 콘텐츠 등급, 광고) 완료.
5. 프로덕션 액세스 신청 -> 승인 후 프로덕션 트랙에 단계적 출시(예: 20%부터).

---

## 9. 릴리스 직전 점검 목록

```bash
npm ci
npm run typecheck && npm test && npm run build
npx cap sync android
cd android && ./gradlew clean bundleRelease --no-daemon
```

- [ ] `android/gradlew` 실행 권한(`git ls-files -s android/gradlew` 이 100755)이 유지되고 있다.
- [ ] `AndroidManifest.xml` 에 `android:appCategory="game"`, `sensorLandscape`, `allowBackup="false"` 가 있다.
- [ ] `git status` 에 `*.keystore`, `*.jks`, `keystore.properties` 가 없다.
- [ ] `versionCode` 와 `versionName` 이 올라갔다.
- [ ] 스토어 문구에 Monopoly / 부루마블 / 모두의마블 등 타사 명칭이 없다 (`docs/research/02-ip-licensing-research.md`).
- [ ] "Land Poly / 랜드폴리" 이름의 상표를 조사하고, 사용자 제공 아이콘의 캐릭터·보드 요소에 대한 사용 권리를 확인했다 (`docs/DESIGN.md` C1).
- [ ] 오픈소스/폰트 고지: `docs/THIRD_PARTY_LICENSES.md` (Noto Sans KR, Jua = SIL OFL 1.1) 를 앱 내 설정 > 라이선스 화면 또는 스토어 소개에서 안내.
