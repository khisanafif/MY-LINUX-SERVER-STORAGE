#!/usr/bin/env bash
# ==============================================================================
#  BUILD APK ANDROID LINUX CLOUD DRIVE & SIMPAN LANGSUNG KE DALAM DRIVE
#  Membutuhkan: Java JDK (javac, keytool) dan Android SDK (build-tools + platform)
# ==============================================================================

set -e
cd "$(dirname "$0")"

ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
OUT_APK="../shared_files/Arsip & Aplikasi/LinuxCloudDrive.apk"

if [ -z "${JAVA_HOME:-}" ] && [ -d "$HOME/.local/jdk-17" ]; then
    export JAVA_HOME="$HOME/.local/jdk-17"
    export PATH="$JAVA_HOME/bin:$PATH"
fi

if ! command -v javac >/dev/null 2>&1 || ! command -v keytool >/dev/null 2>&1; then
    echo "[ERROR] Java JDK (javac, keytool) belum terpasang di sistem."
    echo "        Jalankan: sudo apt update && sudo apt install -y openjdk-17-jdk"
    exit 1
fi

if [ ! -d "$ANDROID_SDK/build-tools" ] || [ ! -d "$ANDROID_SDK/platforms" ]; then
    echo "[ERROR] Android SDK belum ditemukan di: $ANDROID_SDK"
    echo "        Pasang Android SDK (build-tools & platforms) atau set ANDROID_HOME."
    exit 1
fi

BUILD_TOOLS="$(ls -1d "$ANDROID_SDK"/build-tools/* | sort -V | tail -n 1)"
PLATFORM_JAR="$(ls -1 "$ANDROID_SDK"/platforms/*/android.jar | sort -V | tail -n 1)"

rm -rf build && mkdir -p build/gen build/obj build/dex

echo "[1/5] Kompilasi resource Android (aapt2)..."
"$BUILD_TOOLS/aapt2" compile --dir res -o build/res.zip
"$BUILD_TOOLS/aapt2" link -o build/unaligned.apk \
    -I "$PLATFORM_JAR" \
    --manifest AndroidManifest.xml \
    --java build/gen \
    build/res.zip

echo "[2/5] Kompilasi Java source..."
javac --release 8 -classpath "$PLATFORM_JAR" -d build/obj \
    build/gen/com/linuxserver/clouddrive/R.java \
    src/com/linuxserver/clouddrive/MainActivity.java

echo "[3/5] Konversi ke Dalvik bytecode (d8)..."
"$BUILD_TOOLS/d8" --min-api 24 --lib "$PLATFORM_JAR" --output build/dex $(find build/obj -name '*.class')

echo "[4/5] Paketkan & zipalign APK..."
(cd build/dex && zip -q ../unaligned.apk classes.dex)
"$BUILD_TOOLS/zipalign" -f -p 4 build/unaligned.apk build/aligned.apk

if [ ! -f build/debug.keystore ]; then
    keytool -genkeypair -keystore build/debug.keystore -storepass android -keypass android \
        -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=LinuxCloudDrive,O=LocalServer,C=ID" >/dev/null 2>&1
fi

echo "[5/5] Menandatangani APK (apksigner)..."
mkdir -p "$(dirname "$OUT_APK")"
"$BUILD_TOOLS/apksigner" sign --v4-signing-enabled false --ks build/debug.keystore --ks-pass pass:android \
    --key-pass pass:android --out "$OUT_APK" build/aligned.apk
rm -f "${OUT_APK}.idsig"

echo "[SELESAI] APK berhasil dibuat dan tersedia di dalam Drive:"
echo "          $OUT_APK"
