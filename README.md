# HTTT 3D – Mạng cống thoát nước & điểm ngập khu chợ Thủ Đức

Đồ án môn **IE402 – Hệ thống thông tin địa lý 3D** · Trường ĐH Công nghệ Thông tin – ĐHQG-HCM

Quản lý mạng cống ngầm 3D, phân tích điểm ngập và xử lý sự cố quanh chợ Thủ Đức (≈ 1,8 km²).

**Bản chạy trực tuyến:** https://ie402-thuduc-drainage.vercel.app (Vercel + Supabase Cloud, đăng nhập bằng tài khoản demo bên dưới)

- **3D thật sự:** địa hình TIN, mạng cống Node–Arc (`PointZ`/`LineStringZ`), công trình B-Rep (SUDM LOD1–2), hố ga CSG; nhìn xuyên đất trên Cesium.
- **12 phân tích PostGIS** (Q1–Q12): dốc ngược, chôn nông, va chạm 3D, truy vết, hố ga tràn, quá tải (Voronoi + Manning), KNN, trạng thái theo ngày, mặt cắt dọc…
- **Thời gian:** dữ liệu lưỡng thời gian (valid/transaction time) + mô hình sự kiện.
- **Bảo mật:** Supabase Auth, RLS theo vai trò và khu phụ trách, view rút gọn cho khách, audit log.

**Stack:** React · Vite · TypeScript · Tailwind · shadcn/ui · CesiumJS (resium) · Supabase (Postgres + PostGIS, Auth, Storage, Realtime) · Python seed.

## Chạy nhanh (local)

Cần Node ≥ 20, Python ≥ 3.10, Docker.

```bash
npm install
```

```bash
pip install -r scripts/requirements.txt
```

```bash
npx supabase start
```

Lệnh trên tự áp `supabase/migrations/`. Lấy `API URL` và `anon key` từ `npx supabase status`, chép `.env.example` thành `.env.local` rồi điền `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres python3 scripts/seed.py
```

```bash
npm run dev
```

Mở http://localhost:5173.

<details>
<summary>Không có Docker? Dùng Postgres + PostGIS thuần</summary>

```bash
bash scripts/dev/local_db.sh ie402
```

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ie402 python3 scripts/seed.py
```

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ie402 npm run dev:mock-api
```

Chép 2 dòng `VITE_SUPABASE_*` mà lệnh trên in ra vào `.env.local`, rồi chạy `npm run dev`. Chế độ này không có Realtime.
</details>

## Tài khoản demo

Mật khẩu chung **`Demo@123`** (trang đăng nhập có nút đăng nhập nhanh).

| Email | Vai trò |
|---|---|
| admin@demo.vn | Quản trị – toàn quyền, audit log |
| tech1@demo.vn | Kỹ thuật viên Zone A (Tây) |
| tech2@demo.vn | Kỹ thuật viên Zone B (Đông) |
| dan@demo.vn | Người dân – báo sự cố |

## Kiểm thử

| Lệnh | Kết quả mong đợi |
|---|---|
| `psql "$DATABASE_URL" -f scripts/test_topology.sql` | 6 dòng PASS (cống sai topology bị chặn) |
| `npm run test:rpc` (cần `DATABASE_URL` hoặc `SUPABASE_URL` + `SUPABASE_ANON_KEY`) | 36 đạt, 0 lỗi – Q1–Q12 và RLS |
| `psql "$DATABASE_URL" -f scripts/explain_knn.sql` | So sánh KNN có / không có index GIST |

## Dữ liệu

- **Thật (OSM):** tâm chợ, mạng đường, 500 footprint nhà – cache trong `scripts/data/osm_thuduc.json` (© OpenStreetMap contributors, ODbL).
- **Mock:** địa hình, thuộc tính mạng cống, sự cố, quan trắc mưa/mực nước, số tầng/tầng hầm.
- **Điểm ngập:** tên đường theo báo chí, vị trí/độ sâu xấp xỉ; `source_url` hiện là link tìm kiếm.
- **Lỗi cài sẵn để demo:** 3 cống dốc ngược, 3 cống chôn nông, 3 va chạm 3D, 1 cống nâng cấp D800 → D1200.

## Deploy

Đang chạy trên **Vercel** (giao diện) + **Supabase Cloud** (Postgres + PostGIS, Auth, Storage, Realtime). Deploy lại:

```bash
SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... python3 scripts/deploy/supabase_sql.py supabase/migrations/*.sql
```

```bash
PGPASSWORD=postgres bash scripts/deploy/export_seed_sql.sh ie402 deploy_sql
```

```bash
SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... python3 scripts/deploy/supabase_sql.py deploy_sql/*.sql
```

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_ANON_KEY=... npm run build
```

```bash
VERCEL_TOKEN=... python3 scripts/deploy/vercel_deploy.py dist ie402-thuduc-drainage
```

Lần lượt: tạo schema trên project trống → xuất dữ liệu đã seed ở local → nạp lên cloud → build trỏ tới cloud → đưa lên Vercel. Nhớ đặt *Site URL* trong Supabase Auth là domain Vercel.

## Cấu trúc

```
supabase/migrations/   schema · trigger topology/versioning/audit · RLS · RPC Q1–Q12
scripts/               seed.py · test_rpc.ts · test_topology.sql · explain_knn.sql · dev/ · deploy/
src/map/               Cesium: lớp 3D, popup NN/KG/TG, panel phân tích, chỉnh sửa
src/pages/             map · report · incidents · admin · login
docs/THIET_KE.md       báo cáo thiết kế chi tiết
```

## Tài liệu thiết kế

Chi tiết theo yêu cầu môn học nằm trong [`docs/THIET_KE.md`](docs/THIET_KE.md):

- 5 tính chất HTTT → chức năng.
- Đối tượng → NN / KG / TG.
- Lựa chọn mô hình V3D (4 bước, Chương 6).
- Danh sách truy vấn Q1–Q12.
- Nguồn dữ liệu.
- ERD (Mermaid).
- Tóm tắt RLS.
- EXPLAIN ANALYZE cho truy vấn KNN.
- Design system giao diện.
