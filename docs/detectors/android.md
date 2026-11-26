# Android

The `android` detector reports Google Play Billing Library majors past their deprecation deadlines and `targetSdk` levels below Google Play's requirement for existing phone and tablet apps, as declared in `build.gradle`, `build.gradle.kts`, `settings.gradle(.kts)`, and `libs.versions.toml`. It is **supported**: it is scored on the [public corpus](../VALIDATION.md) and held to the corpus precision and recall floors. The full reference is [Android detector](../compatibility/android.md).

## What it reads

| File | Declaration |
| --- | --- |
| `build.gradle`, `build.gradle.kts` | Literal `compileSdk`, `minSdk`, `targetSdk`, and `buildToolsVersion` (including method-call forms like `compileSdk(34)` and legacy `compileSdkVersion` / `minSdkVersion` / `targetSdkVersion` forms) inside an `android { }` block, and string-notation Maven dependencies |
| `settings.gradle`, `settings.gradle.kts` | Literal Android Gradle Plugin and Kotlin Android plugin version pins |
| `libs.versions.toml` | `[versions]` keys `agp` and `kotlin`, plus `[plugins]` entries (`com.android.application`, `com.android.library`, `org.jetbrains.kotlin.android`) including multi-line tables and `[plugins.alias]` sub-tables |

## What it judges

- A string-notation `com.android.billingclient:billing` pin on majors 5 through 9.
- A literal `targetSdk` (or `targetSdkVersion` / `targetSdk(...)`) below 35 inside an `android { }` block (`android.target-sdk.existing.default-below-35`), matching Google Play's requirement for existing default (phone and tablet) apps.
- **Android Gradle Plugin (`pkg:generic/android/agp`)**: reports EOL findings when Ebb ships AGP rules, and emits a `no-data` unclassified reference (`no-data: Ebb has no lifecycle rule for Android Gradle Plugin`) otherwise. Missing AGP rules are tracked on the [Ebb roadmap](https://github.com/velella-sh/org/blob/main/ebb/ROADMAP.md) rather than adding data logic to Offing.

## What it does not judge

- `compileSdk`, `minSdk`, `buildToolsVersion`, and Kotlin pins until a reviewed rule names them.
- SDK settings outside an `android { }` block (for example `extensions.configure<BaseExtension>`).
- Map-notation Maven coordinates and configurations such as `debugImplementation`.
- Wear OS, Android TV, Android XR, and Automotive OS form-factor floors that differ from the default phone/tablet rule.

## Evidence

The Android corpus holds 84 repositories: 56 selected blind (67%), and the reviewed corpus expects 87 Android findings across 42 repositories (including Android findings declared in other ecosystems' pins). 22 Android-bucket repositories have no expected finding of any detector. The selection rules and counts are in [Validation: Android corpus](../validation/ecosystems.md#android-corpus).
