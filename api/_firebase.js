/*
 * _firebase.js
 * Helper Firebase Admin — dipakai oleh semua API route
 * Env vars yang harus diset di Vercel:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (paste isi private_key dari service account JSON, termasuk \n)
 */

let admin = null;
let db    = null;

function initAdmin() {
  if (admin) return; // sudah di-init
  admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId  : process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Vercel menyimpan \n sebagai literal — replace dulu
        privateKey : (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  db = admin.firestore();
}

function getFirestore() {
  if (!db) throw new Error('Firebase belum di-init. Panggil initAdmin() dulu.');
  return db;
}

async function verifyIdToken(idToken) {
  if (!admin) throw new Error('Firebase belum di-init.');
  return admin.auth().verifyIdToken(idToken);
}

module.exports = { initAdmin, getFirestore, verifyIdToken };
