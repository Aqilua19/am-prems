/*
 * /api/limit
 * GET → cek sisa limit hari ini
 * Dipakai frontend untuk tampilkan "Sisa X/2 hari ini"
 */

const { initAdmin, getFirestore, verifyIdToken } = require('./_firebase');

const DAILY_LIMIT = 2;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET')     { res.status(405).json({ ok: false, error: 'Method Not Allowed' }); return; }

  try {
    initAdmin();

    const authHeader = req.headers['authorization'] || '';
    const idToken    = authHeader.replace('Bearer ', '').trim();
    if (!idToken) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    let decoded;
    try {
      decoded = await verifyIdToken(idToken);
    } catch {
      return res.status(401).json({ ok: false, error: 'Token tidak valid' });
    }

    const db    = getFirestore();
    const snap  = await db.collection('usage').doc(decoded.uid).get();
    const today = todayStr();

    let count = 0;
    if (snap.exists && snap.data().date === today) {
      count = snap.data().count || 0;
    }

    const remaining = Math.max(0, DAILY_LIMIT - count);
    return res.status(200).json({
      ok       : true,
      used     : count,
      remaining: remaining,
      limit    : DAILY_LIMIT,
      resetsAt : today + 'T00:00:00Z (besok)',
    });

  } catch (err) {
    console.error('[LIMIT] error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
