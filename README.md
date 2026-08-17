# AM Premium — Vercel + Firebase Deploy Guide

## Struktur File

```
amprems-vercel/
├── api/
│   ├── _firebase.js   ← Firebase Admin helper (shared)
│   ├── send.js        ← /api/send  (kirim magic link + cek limit)
│   ├── verify.js      ← /api/verify (verifikasi link)
│   └── limit.js       ← /api/limit  (cek sisa limit)
├── public/
│   ├── index.html     ← Frontend + Google Login
│   └── config.js      ← Konfigurasi music, Telegram, dsb
├── package.json
├── vercel.json
└── README.md
```

---

## Setup Firebase (WAJIB sebelum deploy)

### 1. Buat Firebase Project
1. Buka [console.firebase.google.com](https://console.firebase.google.com)
2. **Add project** → beri nama → selesaikan wizard
3. Di sidebar: **Build → Authentication → Get started**
4. Pilih **Google** → aktifkan → simpan

### 2. Aktifkan Firestore
1. Di sidebar: **Build → Firestore Database → Create database**
2. Pilih mode **Production**
3. Pilih region (asia-southeast2 untuk Indonesia)
4. Setelah dibuat, buka tab **Rules** → ubah isinya jadi:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /usage/{uid} {
         allow read, write: if false; // hanya server yang boleh akses
       }
     }
   }
   ```
   → **Publish**

### 3. Ambil Web App Config (untuk index.html)
1. **Project Settings** (ikon gear) → **Your apps** → **Add app** → pilih **Web (</>)**
2. Register app → salin config seperti ini:
   ```js
   const FIREBASE_CONFIG = {
     apiKey           : "AIza...",
     authDomain       : "nama-project.firebaseapp.com",
     projectId        : "nama-project",
     storageBucket    : "nama-project.appspot.com",
     messagingSenderId: "12345...",
     appId            : "1:12345...",
   };
   ```
3. Buka `public/index.html` → cari bagian `FIREBASE_CONFIG` → **ganti semua nilai GANTI_...**

### 4. Tambah Authorized Domain di Firebase Auth
1. **Authentication → Settings → Authorized domains**
2. Tambahkan domain Vercel kamu (contoh: `am-premium.vercel.app`)

### 5. Buat Service Account (untuk server/API)
1. **Project Settings → Service accounts**
2. Klik **Generate new private key** → simpan file JSON
3. Dari file JSON tersebut, catat:
   - `project_id`
   - `client_email`
   - `private_key`

---

## Deploy ke Vercel

### 1. Push ke GitHub dulu
```bash
git init
git add .
git commit -m "AM Premium v2 - Vercel + Google Auth"
git remote add origin https://github.com/USERNAME/am-premium.git
git push -u origin main
```

### 2. Import di Vercel
1. Buka [vercel.com](https://vercel.com) → **Add New Project**
2. Import repository GitHub kamu
3. **Framework Preset**: Other
4. **Root Directory**: biarkan default (root)

### 3. Set Environment Variables di Vercel
Masuk ke **Project Settings → Environment Variables**, tambahkan:

| Variable | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | `nama-project-kamu` |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-xxx@nama.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | isi seluruh private_key termasuk `-----BEGIN...END-----` |

> ⚠️ Untuk `FIREBASE_PRIVATE_KEY`: paste apa adanya dari file JSON (Vercel akan handle newline otomatis)

4. **Deploy** → tunggu selesai

---

## Test setelah deploy

1. Buka URL Vercel kamu
2. Klik **Masuk dengan Google** → pilih akun Google
3. Setelah login, coba kirim email target
4. Badge limit di atas akan berubah: `Sisa hari ini: 1 / 2`
5. Setelah 2x: button akan error `Limit harian habis. Coba lagi besok!`

---

## Ubah limit (default: 2x/hari)

Edit `api/send.js` baris 14:
```js
const DAILY_LIMIT = 2; // ganti angkanya
```
Dan `api/limit.js` baris 9:
```js
const DAILY_LIMIT = 2;
```
