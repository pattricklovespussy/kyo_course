web khoa hoc kyo

## Cấu hình Supabase

Ứng dụng hiện đọc và ghi lịch học qua API `/api/schedule`. Backend sẽ đẩy dữ liệu lên Supabase khi có đủ biến môi trường.

### Biến môi trường

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_TABLE=schedule_state
SUPABASE_RECORD_ID=main
```

### Bảng cần tạo

Tạo bảng `schedule_state` với các cột sau:

- `id` text, primary key
- `payload` jsonb
- `updated_at` timestamptz

### Luồng dữ liệu

- `admin.html` lưu lịch qua `/api/schedule`
- `index.html` đọc lịch từ `/api/schedule`
- Nếu chưa cấu hình Supabase, server tạm dùng bộ nhớ trong khi chạy

### Thiết lập nhanh (an toàn)

1. Tạo file môi trường cục bộ `.env` (KHÔNG commit file này vào git).

```
# .env (example - DO NOT COMMIT)
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
SUPABASE_TABLE=schedule_state
SUPABASE_RECORD_ID=main
POSTGRES_CONNECTION_STRING=postgresql://postgres:password@db.xxx.supabase.co:5432/postgres
```

2. Bạn có thể dùng **SQL Editor** trong giao diện Supabase để chạy file `supabase.sql` (đã thêm vào repository) hoặc dùng `psql` với `POSTGRES_CONNECTION_STRING`.

3. Lưu ý bảo mật: `SUPABASE_SERVICE_ROLE_KEY` là key nhạy cảm — chỉ dùng ở backend và không đưa vào client/front-end.

4. Nếu muốn, hãy thêm giá trị thật vào `.env` trên máy local hoặc trên môi trường deploy (Ví dụ: Vercel/Heroku/Render) — không lưu trữ những giá trị này trong mã nguồn.

---

Xem file `supabase.sql` để tạo bảng và chèn bản ghi khởi tạo.
