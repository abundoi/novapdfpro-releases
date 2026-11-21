#!/usr/bin/env bash
# ==============================================================================
# NovaPDFPro - macOS Universal Packaging, Code Signing & Notarization Pipeline
# Targets: macOS Apple Silicon (M1/M2/M3/M4 arm64) & Intel (x86_64)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${ROOT_DIR}/release/macos"
ENTITLEMENTS="${ROOT_DIR}/build/entitlements.mac.plist"

APP_NAME="NovaPDFPro"
VERSION="1.31.0"
BUNDLE_ID="com.novapdfpro.desktop"

DEVELOPER_ID_APP="${DEVELOPER_ID_APP:-}"
APPLE_ID="${APPLE_ID:-}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"
APPLE_APP_SPECIFIC_PASSWORD="${APPLE_APP_SPECIFIC_PASSWORD:-}"
KEYCHAIN_PROFILE="${KEYCHAIN_PROFILE:-novapdfpro-notary}"

echo "=========================================================="
echo "NovaPDFPro macOS Packaging & Security Hardening"
echo "=========================================================="

# 1. Verify build environment
mkdir -p "${DIST_DIR}"

echo "1. Building frontend production bundle..."
cd "${ROOT_DIR}"
npm run build

echo "2. Running security & integrity tests..."
npm test

# 3. Packaging with Electron Packager or Builder
echo "3. Packaging macOS application bundles (arm64 & x64)..."
# If running on macOS with electron-packager or electron-builder installed:
if command -v electron-builder &> /dev/null; then
    echo "Running electron-builder for macOS..."
    npx electron-builder --mac dmg --universal
else
    echo "Electron builder not detected globally. Staging package for macOS packaging host..."
fi

# 4. Code Signing with Hardened Runtime
if [ -n "${DEVELOPER_ID_APP}" ]; then
    echo "4. Applying Apple Developer ID Code Signature with Hardened Runtime..."
    codesign --deep --force --verify --verbose \
        --options runtime \
        --entitlements "${ENTITLEMENTS}" \
        --sign "${DEVELOPER_ID_APP}" \
        "${DIST_DIR}/${APP_NAME}.app"

    # Verify signature
    spctl --assess --type execute --verbose "${DIST_DIR}/${APP_NAME}.app"
    echo "Signature verified successfully."
else
    echo "Notice: DEVELOPER_ID_APP environment variable not set; skipping signing."
    echo "To sign for Gatekeeper: export DEVELOPER_ID_APP='Developer ID Application: Your Name (TeamID)'"
fi

# 5. Apple Notarization
if [ -n "${APPLE_ID}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD}" ] && [ -n "${APPLE_TEAM_ID}" ]; then
    echo "5. Submitting DMG to Apple Notarization Service..."
    xcrun notarytool submit "${DIST_DIR}/${APP_NAME}-${VERSION}.dmg" \
        --apple-id "${APPLE_ID}" \
        --password "${APPLE_APP_SPECIFIC_PASSWORD}" \
        --team-id "${APPLE_TEAM_ID}" \
        --wait

    echo "6. Stapling Notarization ticket to DMG..."
    xcrun stapler staple "${DIST_DIR}/${APP_NAME}-${VERSION}.dmg"
    spctl --assess --type open --context context:primary-signature --verbose "${DIST_DIR}/${APP_NAME}-${VERSION}.dmg"
    echo "Apple Notarization and Stapling complete! Zero Gatekeeper warnings guaranteed."
fi

echo "=========================================================="
echo "macOS build pipeline ready."
echo "=========================================================="
