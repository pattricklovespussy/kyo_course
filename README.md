# PartTime.vn 🇻🇳

Tìm việc làm part-time (Online · Offline · Remote · Hybrid) khắp 63 tỉnh thành Việt Nam.  
Powered by **Google Gemini 2.0 Flash** — hoàn toàn **FREE** (1500 req/ngày, 15 req/phút).

## Cấu trúc

```
parttime-vn/
├── api/
│   └── chat.js       ← Vercel Serverless Function (proxy Gemini)
├── public/
│   └── index.html    ← Frontend
├── vercel.json
└── package.json
```

---

## 🚀 Deploy lên Vercel

### Bước 1 — Lấy Gemini API Key (FREE)
1. Vào https://aistudio.google.com/apikey
2. Đăng nhập Google → "Create API Key"
3. Copy key (dạng AIza...)

### Bước 2 — Push lên GitHub
```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/YOUR/parttime-vn.git
git push -u origin main
```

### Bước 3 — Import vào Vercel
https://vercel.com/new → Import repo → Deploy

### Bước 4 — Thêm API Key
Settings → Environment Variables:
- Name: GEMINI_API_KEY
- Value: AIza...
- Tick Production + Preview + Development → Save

Sau đó: Deployments → Redeploy

### Bước 5 — Done ✅

---

## Local dev
```bash
npm i -g vercel
# Tạo .env.local với GEMINI_API_KEY=AIza...
vercel dev
```
