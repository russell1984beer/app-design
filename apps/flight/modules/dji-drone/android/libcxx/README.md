# libc++_shared.so for the DJI SDK

DJI MSDK 5.18.0's native libraries are built with the NDK r28 C++ runtime (clang 19) and need
symbols such as `__cxa_init_primary_exception` that React Native's copy (NDK r27, clang 18) lacks.
When both copies are in the build, Gradle may package React Native's and the app crashes on start
(`dlopen failed: cannot locate symbol "__cxa_init_primary_exception"` from `libdjisdk_jni.so`).

This is the copy that ships inside `dji-sdk-v5-aircraft-5.18.0.aar` (`jni/arm64-v8a/`). It
contains every symbol React Native's copy has. `plugins/withDji.js` copies it into the app's own
`jniLibs` on `expo prebuild`, which wins over the copies in dependencies. Replace it when the DJI
SDK version changes. It is LLVM libc++ (Apache 2.0 with LLVM exception).
