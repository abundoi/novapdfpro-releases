import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('Security Audit: Electron main & preload enforce sandbox, isolation & IPC allowlists', () => {
  const mainSrc = fs.readFileSync(path.join(rootDir, 'electron', 'main.cjs'), 'utf8');
  const preloadSrc = fs.readFileSync(path.join(rootDir, 'electron', 'preload.cjs'), 'utf8');
  const htmlSrc = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

  assert.match(mainSrc, /nodeIntegration:\s*false/);
  assert.match(mainSrc, /contextIsolation:\s*true/);
  assert.match(mainSrc, /webSecurity:\s*true/);
  assert.match(mainSrc, /sandbox:\s*true/);
  assert.match(mainSrc, /will-attach-webview/);
  assert.match(mainSrc, /will-redirect/);
  assert.match(mainSrc, /setPermissionRequestHandler/);
  assert.match(mainSrc, /setPermissionCheckHandler/);
  assert.match(mainSrc, /isSafePdfPath/);
  assert.match(mainSrc, /validateLocalOllamaUrl/);
  assert.match(mainSrc, /licenseManager\.getStatus\(\)\.tier === 'FREE'/);
  assert.match(mainSrc, /Content-Security-Policy/);

  // Preload must not expose test hooks in production or require Node fs/child_process under sandbox
  assert.ok(!preloadSrc.includes("require('node:fs')"));
  assert.ok(!preloadSrc.includes("require('fs')"));
  assert.match(preloadSrc, /isTestMode\s*\?\s*\{\s*licenseSetMode:/);

  // CSP must block object plugins and avoid unsafe-eval
  assert.ok(!htmlSrc.includes("'unsafe-eval'"));
  assert.match(htmlSrc, /object-src 'none'/);
});

test('Security Audit: LicenseManager pins keys/portal, seals local data with HMAC & guards rollback across OS platforms', () => {
  const lmSrc = fs.readFileSync(path.join(rootDir, 'electron', 'licenseManager.cjs'), 'utf8');
  const storeSrc = fs.readFileSync(path.join(rootDir, 'src', 'stores', 'licenseStore.ts'), 'utf8');
  const appSrc = fs.readFileSync(path.join(rootDir, 'src', 'App.tsx'), 'utf8');
  const buildPs1 = fs.readFileSync(path.join(rootDir, 'installer', 'build-release.ps1'), 'utf8');

  assert.match(lmSrc, /IS_PRODUCTION_RELEASE/);
  assert.match(lmSrc, /computeStorageHmac/);
  assert.match(lmSrc, /timingSafeEqual/);
  assert.match(lmSrc, /clockTampered/);
  assert.match(lmSrc, /IOPlatformUUID/); // Cross-platform macOS hardware identification
  assert.match(lmSrc, /if \(!IS_E2E_TEST\) return this\.getStatus\(\);|if \(!IS_E2E_TEST\) \{\s*return this\.getStatus\(\);/);

  // Fail-closed initial client state and gated test globals
  assert.match(storeSrc, /tier:\s*'FREE'/);
  assert.ok(!storeSrc.includes('novapdfpro_browser_tier'));
  assert.match(appSrc, /window\.electronAPI\?\.isTestMode === true/);
  assert.match(buildPs1, /productionRelease\s*=\s*\$true/);
});

test('Security Audit: macOS Hardened Runtime & Gatekeeper Notarization Entitlements', () => {
  const entitlementsPath = path.join(rootDir, 'build', 'entitlements.mac.plist');
  assert.ok(fs.existsSync(entitlementsPath), 'macOS entitlements file must exist');

  const entitlementsXml = fs.readFileSync(entitlementsPath, 'utf8');
  assert.match(entitlementsXml, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(entitlementsXml, /com\.apple\.security\.cs\.allow-unsigned-executable-memory[\s\S]*?<false\/>/);
  assert.match(entitlementsXml, /com\.apple\.security\.cs\.allow-dyld-environment-variables[\s\S]*?<false\/>/);
  assert.match(entitlementsXml, /com\.apple\.security\.cs\.disable-library-validation[\s\S]*?<false\/>/);
});

test('Installer & Uninstaller: Support Open With, Default PDF Reader & Safe Cleanup', () => {
  const setupCs = fs.readFileSync(path.join(rootDir, 'installer', 'NovaPDFPro-Setup.cs'), 'utf8');
  const uninstallCs = fs.readFileSync(path.join(rootDir, 'installer', 'Uninstall-NovaPDFPro.cs'), 'utf8');
  const launcherCs = fs.readFileSync(path.join(rootDir, 'native-launcher', 'NovaPDFPro.cs'), 'utf8');

  assert.match(setupCs, /NovaPDFPro\.PDF/);
  assert.match(setupCs, /OpenWithProgids/);
  assert.match(setupCs, /SystemFileAssociations\\\.pdf\\shell\\NovaPDFPro/);
  assert.match(setupCs, /RegisteredApplications/);
  assert.match(setupCs, /SHChangeNotify/);

  assert.match(uninstallCs, /DeleteSubKeyTree/);
  assert.match(uninstallCs, /SHChangeNotify/);
  assert.match(uninstallCs, /-EncodedCommand/);

  assert.match(launcherCs, /foreach \(string rawArg in args\)/);
});
