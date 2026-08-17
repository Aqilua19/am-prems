/*
 * /api/send
 * Verifikasi idToken Google → cek rate limit → kirim magic link
 */

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const { initAdmin, getFirestore, verifyIdToken } = require('./_firebase');

// ── Konfigurasi ──────────────────────────────────────────────
const TARGET_OLD = 'https://alight-motion-premium.site.je';
const FB_API_KEY  = 'AIzaSyDrZ9jr_Y16ltSBqsQR5IH6I04FRga6Ki0';
const FB_BASE     = 'https://identitytoolkit.googleapis.com';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DAILY_LIMIT = 2; // maksimal create per hari

// In-memory session store (per instance serverless, cukup untuk primary flow)
const sessions = {};

// ── Fetch wrapper ─────────────────────────────────────────────
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

// ── AES helpers ───────────────────────────────────────────────
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

// ── Primary: alight-motion-premium ────────────────────────────
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

async function primarySend(email) {
  const cookie = await getCookie();
  const res = await postJSON(TARGET_OLD + '/index.php?action=send_eceran', { email }, {
    'Cookie': `__test=${cookie}`,
  });
  const data = JSON.parse(res.text);
  sessions[email] = { cookie, source: 'primary', timestamp: Date.now() };
  return data;
}

// ── Fallback: Firebase ────────────────────────────────────────
async function firebaseSend(email) {
  const res = await postJSON(
    `${FB_BASE}/v1/accounts:sendOobCode?key=${FB_API_KEY}`,
    {
      requestType       : 'EMAIL_SIGNIN',
      email             : email,
      continueUrl       : `https://alightcreative.com?ui_sid=0366624874&ui_sd=0`,
      canHandleCodeInApp: false,
    },
    {
      'Referer': 'https://alightcreative.com/',
      'Origin' : 'https://alightcreative.com',
    }
  );
  const data = JSON.parse(res.text);
  if (res.status !== 200) throw new Error(data.error?.message || JSON.stringify(data));
  sessions[email] = { source: 'firebase', timestamp: Date.now() };
  return data;
}

// ── Rate limit helper (Firestore) ─────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10); // "2026-08-17"
}

async function checkAndUseLimit(uid) {
  const db     = getFirestore();
  const docRef = db.collection('usage').doc(uid);
  const snap   = await docRef.get();
  const today  = todayStr();

  if (!snap.exists || snap.data().date !== today) {
    // hari baru / belum ada → set count 1
    await docRef.set({ date: today, count: 1 });
    return { allowed: true, remaining: DAILY_LIMIT - 1 };
  }

  const count = snap.data().count || 0;
  if (count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  await docRef.update({ count: count + 1 });
  return { allowed: true, remaining: DAILY_LIMIT - count - 1 };
}

// ── Handler Vercel ────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false, error: 'Method Not Allowed' }); return; }

  const sendJSON = (code, obj) => res.status(code).json(obj);

  try {
    initAdmin();

    // 1) Verifikasi token Google
    const authHeader = req.headers['authorization'] || '';
    const idToken    = authHeader.replace('Bearer ', '').trim();
    if (!idToken) return sendJSON(401, { ok: false, error: 'Login Google diperlukan' });

    let decoded;
    try {
      decoded = await verifyIdToken(idToken);
    } catch (e) {
      return sendJSON(401, { ok: false, error: 'Token tidak valid. Silakan login ulang.' });
    }

    const uid = decoded.uid;

    // 2) Cek & pakai limit
    const { allowed, remaining } = await checkAndUseLimit(uid);
    if (!allowed) {
      return sendJSON(429, {
        ok     : false,
        error  : `Limit harian habis (${DAILY_LIMIT}x/hari). Coba lagi besok ya!`,
        remaining: 0,
      });
    }

    // 3) Validasi email target
    const { email } = req.body;
    if (!email || !email.includes('@'))
      return sendJSON(400, { ok: false, error: 'Email tidak valid' });

    console.log(`[SEND] uid=${uid} email=${email} remaining=${remaining}`);

    // 4) Primary → Fallback
    try {
      const data = await primarySend(email);
      return sendJSON(200, { ok: true, source: 'primary', remaining, raw: data });
    } catch (e1) {
      console.warn(`[SEND] primary gagal (${e1.message}) → fallback Firebase`);
    }

    try {
      const data = await firebaseSend(email);
      return sendJSON(200, { ok: true, source: 'firebase', remaining, raw: data });
    } catch (e2) {
      return sendJSON(500, { ok: false, error: `Semua metode gagal: ${e2.message}` });
    }

  } catch (err) {
    console.error('[SEND] error:', err);
    return sendJSON(500, { ok: false, error: 'Internal server error' });
  }
};
