/*
 * /api/verify
 * Verifikasi idToken Google → verifikasi magic link Alight Motion
 */

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const { initAdmin, verifyIdToken } = require('./_firebase');

const TARGET_OLD = 'https://alight-motion-premium.site.je';
const FB_API_KEY  = 'AIzaSyDrZ9jr_Y16ltSBqsQR5IH6I04FRga6Ki0';
const FB_BASE     = 'https://identitytoolkit.googleapis.com';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Shared sessions (dari send.js — di serverless ini terpisah, pakai fallback Firebase)
const sessions = {};

function fetchURL(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u   = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port    : u.port || (u.protocol === 'https:' ? 443 : 80),
      path    : u.pathname + u.search,
      method  : opts.method  || 'GET',
      headers : opts.headers || {},
      timeout : 12000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status : res.statusCode,
        headers: res.headers,
        text   : Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function postJSON(url, body, extraHeaders = {}) {
  const bodyStr = JSON.stringify(body);
  return fetchURL(url, {
    method : 'POST',
    headers: {
      'Content-Type'  : 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'User-Agent'    : UA,
      ...extraHeaders,
    },
    body: bodyStr,
  });
}

function toNumbers(d) {
  const e = [];
  d.replace(/(..)/g, c => { e.push(parseInt(c, 16)); });
  return e;
}
function toHex(d) {
  return d.map(b => (b < 16 ? '0' : '') + b.toString(16)).join('');
}
function decryptAES(encHex, keyHex, ivHex) {
  const dc = crypto.createDecipheriv(
    'aes-128-cbc',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(ivHex, 'hex')
  );
  dc.setAutoPadding(false);
  return Array.from(Buffer.concat([dc.update(Buffer.from(encHex, 'hex')), dc.final()]));
}

async function getCookie() {
  const res  = await fetchURL(TARGET_OLD + '/');
  const html = res.text;
  const aM   = html.match(/a=toNumbers\("([^"]+)"\)/);
  const bM   = html.match(/b=toNumbers\("([^"]+)"\)/);
  const cM   = html.match(/c=toNumbers\("([^"]+)"\)/);
  if (!aM || !bM || !cM) throw new Error('AES params tidak ditemukan');
  return toHex(decryptAES(
    Buffer.from(toNumbers(cM[1])).toString('hex'),
    Buffer.from(toNumbers(aM[1])).toString('hex'),
    Buffer.from(toNumbers(bM[1])).toString('hex')
  ));
}

async function primaryVerify(email, link) {
  const cookie = await getCookie();
  const res = await postJSON(TARGET_OLD + '/index.php?action=verify_eceran', { email, link }, {
    'Cookie': `__test=${cookie}`,
  });
  return JSON.parse(res.text);
}

function extractOobCode(rawLink) {
  try {
    const decoded    = decodeURIComponent(rawLink);
    const innerMatch = decoded.match(/[?&]link=([^&\s]+)/);
    const targetUrl  = innerMatch ? decodeURIComponent(innerMatch[1]) : decoded;
    const oobMatch   = targetUrl.match(/[?&]oobCode=([^&\s]+)/);
    if (!oobMatch) throw new Error('oobCode tidak ditemukan');
    return decodeURIComponent(oobMatch[1]);
  } catch (e) {
    throw new Error('Gagal parse link: ' + e.message);
  }
}

async function firebaseVerify(email, rawLink) {
  const oobCode = extractOobCode(rawLink);
  const res = await postJSON(
    `${FB_BASE}/v1/accounts:signInWithEmailLink?key=${FB_API_KEY}`,
    { email, oobCode },
    { 'Referer': 'https://alightcreative.com/', 'Origin': 'https://alightcreative.com' }
  );
  const data = JSON.parse(res.text);
  if (res.status !== 200) throw new Error(data.error?.message || JSON.stringify(data));
  return { success: true, idToken: data.idToken, email: data.email, duration: '1 Year' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false, error: 'Method Not Allowed' }); return; }

  const sendJSON = (code, obj) => res.status(code).json(obj);

  try {
    initAdmin();

    // Verifikasi token Google (wajib login)
    const authHeader = req.headers['authorization'] || '';
    const idToken    = authHeader.replace('Bearer ', '').trim();
    if (!idToken) return sendJSON(401, { ok: false, error: 'Login Google diperlukan' });

    try {
      await verifyIdToken(idToken);
    } catch (e) {
      return sendJSON(401, { ok: false, error: 'Token tidak valid. Silakan login ulang.' });
    }

    const { email, link } = req.body;
    if (!email || !link)
      return sendJSON(400, { ok: false, error: 'Email dan link diperlukan' });

    console.log(`[VERIFY] email=${email}`);

    // Coba primary dulu, fallback Firebase
    try {
      const data = await primaryVerify(email, link);
      return sendJSON(200, { ok: true, source: 'primary', raw: data });
    } catch (e1) {
      console.warn(`[VERIFY] primary gagal (${e1.message}) → fallback Firebase`);
    }

    try {
      const data = await firebaseVerify(email, link);
      return sendJSON(200, { ok: true, source: 'firebase', raw: data });
    } catch (e2) {
      return sendJSON(500, { ok: false, error: `Verifikasi gagal: ${e2.message}` });
    }

  } catch (err) {
    console.error('[VERIFY] error:', err);
    return sendJSON(500, { ok: false, error: 'Internal server error' });
  }
};
