const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { execSync } = require('node:child_process');
const { safeStorage } = require('electron');

function loadBuildConfig() {
  try {
    const cfgPath = path.join(__dirname, 'build-config.json');
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
  } catch {
    // Ignore optional build-config errors
  }
  return {};
}

const BUILD_CONFIG = loadBuildConfig();
const IS_PRODUCTION_RELEASE = BUILD_CONFIG.productionRelease === true;
const IS_E2E_TEST = !IS_PRODUCTION_RELEASE && process.env.NOVAPDFPRO_E2E_TEST === '1';

const DEFAULT_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA83niFhvivmTASKGW7xCyn0jYv+v4XK10cvQTocK63QQ=
-----END PUBLIC KEY-----`;

const TRIAL_DAYS = 14;
const PINNED_PORTAL_URL = 'https://novapdf.appmys.com';
const DEFAULT_PORTAL_URL = IS_E2E_TEST
  ? process.env.NOVAPDFPRO_PORTAL_URL || BUILD_CONFIG.portalUrl || PINNED_PORTAL_URL
  : BUILD_CONFIG.portalUrl || PINNED_PORTAL_URL;

function toUnixSec(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.floor(val);
  if (typeof val === 'string' && val.trim()) {
    const ms = Date.parse(val);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return undefined;
}

function maskLicenseKeyValue(key) {
  const clean = String(key || '').trim();
  if (!clean) return undefined;
  if (clean.includes('*')) return clean;
  const parts = clean.split('-');
  if (parts.length === 5) {
    return `${parts[0]}-${parts[1]}-****-****-${parts[4]}`;
  }
  return clean;
}

function isBase44Portal(baseUrl) {
  const lower = String(baseUrl || '').toLowerCase();
  if (BUILD_CONFIG.apiMode === 'nextjs') return false;
  if (BUILD_CONFIG.apiMode === 'base44') return true;
  return !lower.includes('localhost') && !lower.includes('127.0.0.1');
}

function buildApiEndpoint(baseUrl, action) {
  const cleanBase = String(baseUrl || DEFAULT_PORTAL_URL).replace(/\/+$/, '');
  if (isBase44Portal(cleanBase)) {
    const fnMap = {
      trial: '/functions/licenseTrial',
      activate: '/functions/licenseActivate',
      refresh: '/functions/licenseRefresh',
      deactivate: '/functions/licenseDeactivate',
    };
    return `${cleanBase}${fnMap[action]}`;
  }
  return `${cleanBase}/api/license/${action}`;
}

function getPublicKeyPem() {
  if (IS_E2E_TEST && process.env.NOVAPDFPRO_LICENSE_PUBLIC_KEY) {
    return process.env.NOVAPDFPRO_LICENSE_PUBLIC_KEY.replace(/\\n/g, '\n');
  }
  return (BUILD_CONFIG.publicKeyPem || DEFAULT_PUBLIC_KEY_PEM).replace(/\\n/g, '\n');
}

function sanitizePortalUrl(requestedUrl) {
  if (!IS_E2E_TEST) {
    return DEFAULT_PORTAL_URL.replace(/\/+$/, '');
  }
  const candidate = String(requestedUrl || DEFAULT_PORTAL_URL).trim().replace(/\/+$/, '');
  return candidate || DEFAULT_PORTAL_URL;
}

function deriveMachineFingerprint() {
  let rawId = `${os.hostname()}|${os.platform()}|${os.arch()}`;
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: 'utf8', timeout: 1500, windowsHide: true }
      );
      const match = out.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
      if (match && match[1]) {
        rawId = match[1].trim();
      }
    } else if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
        encoding: 'utf8',
        timeout: 1500,
      });
      const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
      if (match && match[1]) {
        rawId = match[1].trim();
      }
    } else if (process.platform === 'linux') {
      const candidatePaths = ['/etc/machine-id', '/var/lib/dbus/machine-id'];
      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, 'utf8').trim();
          if (content) {
            rawId = content;
            break;
          }
        }
      }
    }
  } catch {
    // Fallback to host identifier
  }
  return crypto.createHash('sha256').update(`novapdfpro:${rawId}`).digest('hex').slice(0, 32);
}

function verifyEd25519Token(token, expectedFingerprint, nowSec = Math.floor(Date.now() / 1000)) {
  try {
    const parts = String(token || '').trim().split('.');
    if (parts.length !== 2) {
      return { valid: false, reason: 'Malformed license token format' };
    }
    const [encodedPayload, encodedSig] = parts;
    const verified = crypto.verify(
      null,
      Buffer.from(encodedPayload, 'utf-8'),
      getPublicKeyPem(),
      Buffer.from(encodedSig, 'base64url')
    );
    if (!verified) {
      return { valid: false, reason: 'Invalid Ed25519 signature' };
    }
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8'));
    if (
      expectedFingerprint &&
      String(payload.machineFingerprint || '').trim().toUpperCase() !==
        String(expectedFingerprint).trim().toUpperCase()
    ) {
      return { valid: false, reason: 'License token belongs to a different device' };
    }
    const offlineUntilSec = toUnixSec(payload.offlineValidUntil);
    if (offlineUntilSec !== undefined && offlineUntilSec < nowSec) {
      return { valid: false, payload, reason: 'Offline license lease expired' };
    }
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

function computeStorageHmac(rawJson, integrityKey) {
  return crypto
    .createHmac('sha256', `novapdfpro-integrity:${integrityKey}`)
    .update(rawJson, 'utf8')
    .digest('hex');
}

function writeProtectedJson(filePath, obj, integrityKey = '') {
  try {
    const rawJson = JSON.stringify(obj);
    const envelope = JSON.stringify({
      v: 2,
      data: rawJson,
      mac: computeStorageHmac(rawJson, integrityKey),
    });
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(envelope);
      fs.writeFileSync(filePath, Buffer.concat([Buffer.from('DPAPI1:'), encrypted]));
    } else {
      fs.writeFileSync(filePath, 'PLAIN2:' + envelope, 'utf8');
    }
  } catch {
    // Ignore storage write errors in restricted test sandboxes
  }
}

function readProtectedJson(filePath, integrityKey = '') {
  try {
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    let rawText = null;
    if (buf.subarray(0, 7).toString('utf8') === 'DPAPI1:') {
      if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null;
      rawText = safeStorage.decryptString(buf.subarray(7));
    } else if (buf.subarray(0, 7).toString('utf8') === 'PLAIN2:') {
      rawText = buf.subarray(7).toString('utf8');
    } else if (buf.subarray(0, 7).toString('utf8') === 'PLAIN1:') {
      // Legacy fallback only outside production release
      if (IS_PRODUCTION_RELEASE) return null;
      return JSON.parse(buf.subarray(7).toString('utf8'));
    } else {
      return null;
    }

    const parsed = JSON.parse(rawText);
    if (parsed && parsed.v === 2 && typeof parsed.data === 'string' && typeof parsed.mac === 'string') {
      const expectedMac = computeStorageHmac(parsed.data, integrityKey);
      const macBuf = Buffer.from(parsed.mac, 'utf8');
      const expBuf = Buffer.from(expectedMac, 'utf8');
      if (macBuf.length !== expBuf.length || !crypto.timingSafeEqual(macBuf, expBuf)) {
        return null;
      }
      return JSON.parse(parsed.data);
    }
    return IS_PRODUCTION_RELEASE ? null : parsed;
  } catch {
    return null;
  }
}

function postJson(urlStr, bodyObj) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const client = url.protocol === 'https:' ? https : http;
      const payload = JSON.stringify(bodyObj);
      const req = client.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 8000,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body || '{}');
              resolve({ status: res.statusCode || 500, data: parsed });
            } catch {
              resolve({ status: res.statusCode || 500, data: { error: body } });
            }
          });
        }
      );
      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Licensing server connection timed out'));
      });
      req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

class LicenseManager {
  constructor(baseStorageDir, appVersion = '01.31') {
    this.baseStorageDir = baseStorageDir;
    this.appVersion = appVersion;
    this.licensePath = path.join(baseStorageDir, 'license.dat');
    this.trialPath = path.join(baseStorageDir, 'trial.dat');
    this.machineFingerprint = deriveMachineFingerprint();
    this.deviceName = os.hostname() || 'Windows PC';
    this.memoryLicenseRecord = null;
    this.memoryTrialRecord = null;
  }

  _readTrial() {
    return this.memoryTrialRecord || readProtectedJson(this.trialPath, this.machineFingerprint);
  }

  _writeTrial(record) {
    this.memoryTrialRecord = record;
    writeProtectedJson(this.trialPath, record, this.machineFingerprint);
  }

  _readLicense() {
    return this.memoryLicenseRecord || readProtectedJson(this.licensePath, this.machineFingerprint);
  }

  _writeLicense(record) {
    this.memoryLicenseRecord = record;
    if (record === null) {
      try {
        if (fs.existsSync(this.licensePath)) fs.unlinkSync(this.licensePath);
      } catch {
        // Ignore
      }
      return;
    }
    writeProtectedJson(this.licensePath, record, this.machineFingerprint);
  }

  ensureTrialInitialized() {
    let trial = this._readTrial();
    const nowSec = Math.floor(Date.now() / 1000);
    if (!trial) {
      const endsSec = nowSec + TRIAL_DAYS * 86400;
      trial = {
        startedAt: nowSec,
        lastSeenAt: nowSec,
        trialEndsAt: endsSec,
        machineFingerprint: this.machineFingerprint,
      };
      this._writeTrial(trial);
    } else if (nowSec > (trial.lastSeenAt || 0) + 300) {
      trial = { ...trial, lastSeenAt: nowSec };
      this._writeTrial(trial);
    }
    return trial;
  }

  getStatus() {
    const rawNowSec = Math.floor(Date.now() / 1000);
    const licRecord = this._readLicense();
    const trialPre = this._readTrial();
    const effectiveNowSec = Math.max(rawNowSec, trialPre?.lastSeenAt || 0);

    if (licRecord && licRecord.token) {
      const check = verifyEd25519Token(licRecord.token, this.machineFingerprint, effectiveNowSec);
      if (check.valid && check.payload) {
        return {
          tier: 'PRO',
          status: check.payload.status,
          email: check.payload.email || licRecord.email || 'Licensed Account',
          plan: check.payload.plan,
          licenseKeyMasked:
            check.payload.licenseKeyMasked ||
            maskLicenseKeyValue(check.payload.licenseKey || licRecord.licenseKey),
          maxSeats: check.payload.maxSeats || 2,
          offlineValidUntil: toUnixSec(check.payload.offlineValidUntil),
          currentPeriodEnd:
            toUnixSec(check.payload.currentPeriodEnd) ?? toUnixSec(licRecord.currentPeriodEnd),
          portalUrl: licRecord.portalUrl || DEFAULT_PORTAL_URL,
          machineFingerprint: this.machineFingerprint,
          deviceName: this.deviceName,
          trialDaysRemaining: 0,
        };
      }
    }

    const trial = this.ensureTrialInitialized();
    const clockTampered =
      typeof trial.lastSeenAt === 'number' && rawNowSec < trial.lastSeenAt - 86400;
    if (!trial.forcedFree && !trial.trialExpired && !clockTampered) {
      if (trial.trialToken) {
        const trialCheck = verifyEd25519Token(trial.trialToken, this.machineFingerprint, effectiveNowSec);
        if (trialCheck.valid && trialCheck.payload && trialCheck.payload.status === 'TRIALING') {
          const trialEndSec =
            toUnixSec(trialCheck.payload.currentPeriodEnd) ??
            toUnixSec(trialCheck.payload.trialEndsAt) ??
            toUnixSec(trialCheck.payload.offlineValidUntil);
          const remainingSec = (trialEndSec || 0) - effectiveNowSec;
          if (remainingSec > 0) {
            return {
              tier: 'TRIAL',
              status: 'TRIALING',
              trialDaysRemaining: Math.max(1, Math.ceil(remainingSec / 86400)),
              trialEndsAt: trialEndSec,
              trialAnchored: true,
              portalUrl: DEFAULT_PORTAL_URL,
              machineFingerprint: this.machineFingerprint,
              deviceName: this.deviceName,
            };
          }
        }
      } else {
        const remainingSec = (toUnixSec(trial.trialEndsAt) || 0) - effectiveNowSec;
        if (remainingSec > 0) {
          return {
            tier: 'TRIAL',
            status: 'TRIALING',
            trialDaysRemaining: Math.max(1, Math.ceil(remainingSec / 86400)),
            trialEndsAt: toUnixSec(trial.trialEndsAt),
            trialAnchored: false,
            portalUrl: DEFAULT_PORTAL_URL,
            machineFingerprint: this.machineFingerprint,
            deviceName: this.deviceName,
          };
        }
      }
    }

    return {
      tier: 'FREE',
      status: 'FREE',
      trialDaysRemaining: 0,
      trialExpired: true,
      trialAnchored: Boolean(trial.trialExpired || trial.trialToken),
      portalUrl: DEFAULT_PORTAL_URL,
      machineFingerprint: this.machineFingerprint,
      deviceName: this.deviceName,
    };
  }

  async activateKey(licenseKey, portalUrl = DEFAULT_PORTAL_URL) {
    const cleanBase = sanitizePortalUrl(portalUrl);
    const endpoint = buildApiEndpoint(cleanBase, 'activate');
    const resp = await postJson(endpoint, {
      licenseKey: String(licenseKey || '').trim().toUpperCase(),
      machineFingerprint: this.machineFingerprint,
      deviceName: this.deviceName,
      appVersion: this.appVersion,
    });

    if (resp.status >= 400 || !resp.data?.token) {
      return {
        success: false,
        error: resp.data?.error || 'License activation rejected by server',
      };
    }

    const verify = verifyEd25519Token(resp.data.token, this.machineFingerprint);
    if (!verify.valid) {
      return { success: false, error: verify.reason || 'Signature verification failed' };
    }

    this._writeLicense({
      token: resp.data.token,
      portalUrl: cleanBase,
      email: resp.data.email || verify.payload?.email,
      licenseKey: resp.data.licenseKey || verify.payload?.licenseKey,
      currentPeriodEnd: toUnixSec(resp.data.currentPeriodEnd ?? verify.payload?.currentPeriodEnd),
      activatedAt: Math.floor(Date.now() / 1000),
    });

    return { success: true, status: this.getStatus() };
  }

  importOfflineToken(token) {
    const verify = verifyEd25519Token(token, this.machineFingerprint);
    if (!verify.valid) {
      return { success: false, error: verify.reason || 'Invalid offline license token' };
    }
    this._writeLicense({
      token: String(token).trim(),
      portalUrl: DEFAULT_PORTAL_URL,
      email: verify.payload?.email,
      licenseKey: verify.payload?.licenseKey,
      currentPeriodEnd: toUnixSec(verify.payload?.currentPeriodEnd),
      activatedAt: Math.floor(Date.now() / 1000),
    });
    return { success: true, status: this.getStatus() };
  }

  async refresh(portalUrl) {
    const licRecord = this._readLicense();
    if (!licRecord || !licRecord.token) {
      return { success: false, error: 'No active license token stored' };
    }
    const cleanBase = sanitizePortalUrl(portalUrl || licRecord.portalUrl);
    const endpoint = buildApiEndpoint(cleanBase, 'refresh');
    const resp = await postJson(endpoint, {
      token: licRecord.token,
      machineFingerprint: this.machineFingerprint,
    });

    if (resp.status >= 400 || !resp.data?.token) {
      const errCode = resp.data?.code || resp.data?.error;
      if (errCode === 'REVOKED' || errCode === 'DEACTIVATED' || errCode === 'EXPIRED') {
        this._writeLicense(null);
      }
      return {
        success: false,
        error: resp.data?.error || 'Unable to refresh license online',
        status: this.getStatus(),
      };
    }

    this._writeLicense({
      token: resp.data.token,
      portalUrl: cleanBase,
      email: resp.data.email || licRecord.email,
      licenseKey: resp.data.licenseKey || licRecord.licenseKey,
      currentPeriodEnd: toUnixSec(resp.data.currentPeriodEnd) ?? licRecord.currentPeriodEnd,
      activatedAt: Math.floor(Date.now() / 1000),
    });
    return { success: true, status: this.getStatus() };
  }

  async deactivate(portalUrl) {
    const licRecord = this._readLicense();
    if (licRecord && licRecord.token) {
      const check = verifyEd25519Token(licRecord.token, this.machineFingerprint, 0);
      if (check.payload?.licenseId) {
        try {
          const cleanBase = sanitizePortalUrl(portalUrl || licRecord.portalUrl);
          await postJson(buildApiEndpoint(cleanBase, 'deactivate'), {
            licenseId: check.payload.licenseId,
            machineFingerprint: this.machineFingerprint,
            token: licRecord.token,
          });
        } catch {
          // Even if offline, clear local license binding
        }
      }
    }
    this._writeLicense(null);
    return { success: true, status: this.getStatus() };
  }

  applyServerTrialToken(token) {
    const verify = verifyEd25519Token(token, this.machineFingerprint);
    if (!verify.valid || !verify.payload || verify.payload.status !== 'TRIALING') {
      return { success: false, error: verify.reason || 'Invalid server trial token' };
    }
    const trialEndsSec =
      toUnixSec(verify.payload.currentPeriodEnd) ??
      toUnixSec(verify.payload.trialEndsAt) ??
      toUnixSec(verify.payload.offlineValidUntil);
    this._writeTrial({
      startedAt: toUnixSec(verify.payload.issuedAt) || Math.floor(Date.now() / 1000),
      trialEndsAt: trialEndsSec,
      trialToken: String(token).trim(),
      machineFingerprint: this.machineFingerprint,
      forcedFree: false,
      trialExpired: false,
    });
    return { success: true, status: this.getStatus() };
  }

  async syncTrialWithServer(portalUrl = DEFAULT_PORTAL_URL) {
    const licRecord = this._readLicense();
    if (licRecord && licRecord.token) {
      const check = verifyEd25519Token(licRecord.token, this.machineFingerprint);
      if (check.valid) {
        return { success: true, status: this.getStatus() };
      }
    }

    const existing = this.ensureTrialInitialized();
    if (existing.forcedFree) {
      return { success: false, status: this.getStatus() };
    }

    try {
      const cleanBase = sanitizePortalUrl(portalUrl);
      const resp = await postJson(buildApiEndpoint(cleanBase, 'trial'), {
        machineFingerprint: this.machineFingerprint,
        deviceName: this.deviceName,
      });

      if (resp.status === 200 && resp.data?.token) {
        return this.applyServerTrialToken(resp.data.token);
      }

      if (resp.status === 403 && resp.data?.expired) {
        this._writeTrial({
          ...existing,
          trialEndsAt: toUnixSec(resp.data.trialEndsAt) || 0,
          trialExpired: true,
          trialToken: undefined,
        });
        return { success: false, expired: true, status: this.getStatus() };
      }

      return { success: false, error: resp.data?.error || 'Trial sync skipped', status: this.getStatus() };
    } catch {
      return { success: false, offline: true, status: this.getStatus() };
    }
  }

  setModeForTesting(mode) {
    if (!IS_E2E_TEST) {
      return this.getStatus();
    }
    if (mode === 'FREE') {
      this._writeLicense(null);
      const trial = this.ensureTrialInitialized();
      this._writeTrial({ ...trial, forcedFree: true });
    } else if (mode === 'TRIAL') {
      this._writeLicense(null);
      const nowSec = Math.floor(Date.now() / 1000);
      this._writeTrial({
        startedAt: nowSec,
        trialEndsAt: nowSec + TRIAL_DAYS * 86400,
        machineFingerprint: this.machineFingerprint,
        forcedFree: false,
        trialExpired: false,
        trialToken: undefined,
      });
    }
    return this.getStatus();
  }
}

module.exports = {
  LicenseManager,
  verifyEd25519Token,
  deriveMachineFingerprint,
};
