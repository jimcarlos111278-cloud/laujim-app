const https = require('https');
let truecaller = null;
try {
  truecaller = require('truecallerjs');
} catch {
  // Fallback si truecallerjs no está disponible
}

class CallerIdProviderError extends Error {
  constructor(code, message, retryable, status = null) {
    super(message);
    this.name = 'CallerIdProviderError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeNullableText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase().startsWith('unknown')) return null;
  return trimmed;
}

function parseTruecallerHtml(html) {
  if (html.includes('limit-exceeded') || html.includes('Sign in to unlock caller name')) {
    return {
      limitExceeded: true,
      possibleName: null,
      email: null,
      avatarUrl: null,
      isSpam: false,
      reportCount: 0,
      category: null,
      spamScore: 0
    };
  }

  // Descartar la sesión del usuario logueado en la barra de navegación para evitar falsos positivos
  const cleanHtml = html.replace(/<astro-island[^>]*UserAccount[\s\S]*?<\/astro-island>/gi, '');

  let name = null;
  const vcardMatch = cleanHtml.match(/FN%3A%20([^%&]+)/i) || cleanHtml.match(/FN:\s*([^\r\n<]+)/i);
  if (vcardMatch) {
    name = decodeURIComponent(vcardMatch[1]).replace(/\+/g, ' ').trim();
  }
  if (!name) {
    const nameMatch = cleanHtml.match(/class="[^"]*font-bold[^"]*"[^>]*>([^<]+)<\/div>/i);
    if (nameMatch && !nameMatch[1].includes('Truecaller')) name = nameMatch[1].trim();
  }
  if (!name) {
    const entityMatch = cleanHtml.match(/&quot;name&quot;:\s*\[\s*\d+\s*,\s*&quot;([^&"]+)&quot;/i);
    if (entityMatch && !entityMatch[1].endsWith('.json')) {
      name = entityMatch[1].trim();
    }
  }

  let email = null;
  const emailEntityMatch = cleanHtml.match(/&quot;email&quot;:\s*\[\s*\d+\s*,\s*&quot;([^&"]+)&quot;/i);
  if (emailEntityMatch) {
    email = emailEntityMatch[1].trim();
  } else {
    const emailMatch = cleanHtml.match(/EMAIL%3A%20([^%&]+)/i) || cleanHtml.match(/EMAIL:\s*([^\r\n<]+)/i);
    if (emailMatch) email = decodeURIComponent(emailMatch[1]).trim();
  }

  let avatarUrl = null;
  const avatarEntityMatch = cleanHtml.match(/&quot;image&quot;:\s*\[\s*\d+\s*,\s*&quot;([^&"]+)&quot;/i);
  if (avatarEntityMatch) {
    avatarUrl = avatarEntityMatch[1].trim();
  } else {
    const avatarMatch = cleanHtml.match(/(https:\/\/images-[^"'\s]*truecallerstatic\.com[^"'\s]+)/i);
    if (avatarMatch) avatarUrl = avatarMatch[1];
  }

  const isSpam = cleanHtml.includes('spam-icon.svg') && (cleanHtml.includes('Spam reports') || cleanHtml.includes('reportes'));
  let reportCount = 0;
  const reportMatch = cleanHtml.match(/(\d+)\s*(?:spam reports|reportes)/i);
  if (reportMatch) reportCount = parseInt(reportMatch[1], 10);

  return {
    limitExceeded: false,
    possibleName: normalizeNullableText(name),
    email: normalizeNullableText(email),
    avatarUrl: normalizeNullableText(avatarUrl),
    isSpam,
    reportCount: reportCount || null,
    category: isSpam ? 'Spam' : null,
    spamScore: isSpam ? 1.0 : 0.0
  };
}

class TruecallerProvider {
  constructor(options = {}) {
    let envCookie = process.env.TRUECALLER_COOKIE;
    let envId = process.env.TRUECALLER_INSTALLATION_ID;

    if (!envCookie && !envId) {
      const fs = require('fs');
      const path = require('path');
      for (const loc of [path.join(__dirname, '..', '..', '.env'), '/app/.env', '/home/ubuntu/laujim-app/.env', path.join(process.cwd(), '.env')]) {
        try {
          if (fs.existsSync(loc)) {
            const lines = fs.readFileSync(loc, 'utf8').split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const idx = trimmed.indexOf('=');
                const key = trimmed.slice(0, idx).trim();
                let val = trimmed.slice(idx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                  val = val.slice(1, -1);
                }
                if (!process.env[key]) process.env[key] = val;
                if (key === 'TRUECALLER_COOKIE') envCookie = val;
                if (key === 'TRUECALLER_INSTALLATION_ID') envId = val;
              }
            }
            if (envCookie || envId) break;
          }
        } catch {}
      }
    }

    let rawToken = options.cookie || options.installationId || envCookie || envId || '';
    rawToken = rawToken.replace(/^["'\\s]+|["'\\s]+$/g, '').trim();

    // Si el token contiene la cookie o el objeto json de sesión
    if (rawToken.includes('tc_user=')) {
      const match = rawToken.match(/tc_user=([^;\s]+)/);
      this.cookie = match ? `tc_user=${match[1]}` : rawToken;
      this.installationId = null;
    } else if (rawToken.includes('%22token%22') || rawToken.includes('"token"')) {
      this.cookie = `tc_user=${rawToken}`;
      this.installationId = null;
    } else {
      this.installationId = rawToken || null;
      this.cookie = null;
    }

    this.countryCode = (options.countryCode || process.env.TRUECALLER_COUNTRY || 'CO').toLowerCase();
  }

  isConfigured() {
    return Boolean(this.cookie || this.installationId);
  }

  async lookup(phoneE164) {
    if (!this.isConfigured()) {
      throw new CallerIdProviderError(
        'AUTH_REQUIRED',
        'TRUECALLER_COOKIE / TRUECALLER_INSTALLATION_ID is not configured',
        false
      );
    }

    // Extraer dígitos limpios (por ejemplo +573107203822 -> 3107203822)
    const digits = phoneE164.replace(/\D/g, '');
    const nationalNumber = digits.startsWith('57') && digits.length === 12 ? digits.substring(2) : digits;

    if (this.cookie) {
      return this._lookupViaWeb(this.countryCode, nationalNumber, phoneE164);
    }

    return this._lookupViaCli(phoneE164);
  }

  async _lookupViaWeb(countryCode, nationalNumber, fullPhone) {
    return new Promise((resolve, reject) => {
      const targetUrl = `https://www.truecaller.com/search/${countryCode}/${nationalNumber}`;
      const options = {
        headers: {
          'Cookie': this.cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
        }
      };

      const req = https.get(targetUrl, options, (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          return reject(new CallerIdProviderError('AUTH_REQUIRED', 'Truecaller session cookie has expired', false, res.statusCode));
        }
        if (res.statusCode === 429) {
          return reject(new CallerIdProviderError('RATE_LIMITED', 'Truecaller rate limit reached', true, 429));
        }
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && res.headers.location.includes('auth')) {
          return reject(new CallerIdProviderError('AUTH_REQUIRED', 'Truecaller redirected to auth', false, res.statusCode));
        }

        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          const parsed = parseTruecallerHtml(body);
          if (parsed.limitExceeded) {
            return reject(new CallerIdProviderError(
              'RATE_LIMITED',
              'Límite diario de consultas excedido en la cuenta de Truecaller (limit-exceeded). Renueva la sesión o intenta más tarde.',
              true,
              429
            ));
          }

          if (!parsed.possibleName) {
            return resolve({
              status: 'not_found',
              possibleName: null,
              category: null,
              spamScore: 0,
              reportCount: 0,
              avatarUrl: null,
              email: null,
              location: 'Colombia'
            });
          }

          resolve({
            status: 'found',
            possibleName: parsed.possibleName,
            alternateName: null,
            category: parsed.category,
            spamScore: parsed.spamScore,
            reportCount: parsed.reportCount,
            location: 'Colombia',
            lineType: 'Mobile',
            avatarUrl: parsed.avatarUrl,
            email: parsed.email,
            isSpam: parsed.isSpam
          });
        });
      });

      req.on('error', (err) => {
        reject(new CallerIdProviderError('PROVIDER_FAILED', err.message, true));
      });

      req.setTimeout(8000, () => {
        req.destroy();
        reject(new CallerIdProviderError('TIMEOUT', 'Truecaller lookup timed out', true));
      });
    });
  }

  async _lookupViaCli(phoneE164) {
    if (!truecaller) {
      throw new CallerIdProviderError('PROVIDER_FAILED', 'truecallerjs is not available', false);
    }
    const response = await truecaller.search({
      number: phoneE164,
      countryCode: this.countryCode.toUpperCase(),
      installationId: this.installationId
    });

    const raw = typeof response?.json === 'function' ? response.json() : response;
    if (!raw || !Array.isArray(raw.data)) {
      throw new CallerIdProviderError('PROVIDER_FAILED', 'Truecaller API returned invalid response', true);
    }

    const item = raw.data[0] || null;
    if (!item) {
      return { status: 'not_found', raw };
    }

    const address = Array.isArray(item.addresses) ? item.addresses[0] : null;
    const spam = item.spamInfo && typeof item.spamInfo === 'object' ? item.spamInfo : {};

    return {
      status: 'found',
      possibleName: normalizeNullableText(item.name),
      alternateName: normalizeNullableText(item.altName),
      category: normalizeNullableText(spam.spamType || spam.category),
      spamScore: firstFiniteNumber(spam.spamScore, item.spamScore),
      reportCount: firstFiniteNumber(spam.spamReports, item.spamReports),
      location: normalizeNullableText(address?.city) || 'Colombia',
      lineType: normalizeNullableText(item.lineType) || 'Mobile',
      avatarUrl: normalizeNullableText(item.image || item.imageUrl),
      email: null
    };
  }
}

module.exports = {
  TruecallerProvider,
  CallerIdProviderError
};

