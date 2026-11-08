/**
 * Từ điển trường dữ liệu: tên cột CSDL → nhãn tiếng Việt, đơn vị, cách định dạng.
 * Dùng chung cho popup, bảng kết quả, form sửa ⇒ không lộ tên cột snake_case ra giao diện.
 */
type Fmt = 'num' | 'int' | 'pct' | 'slope' | 'date' | 'bool' | 'text' | 'status' | 'kind'
export interface FieldDef { label: string; unit?: string; fmt?: Fmt; digits?: number }

export const FIELDS: Record<string, FieldDef> = {
  id: { label: 'ID', fmt: 'int' }, code: { label: 'Mã' }, name: { label: 'Tên' }, kind: { label: 'Loại', fmt: 'kind' },
  status: { label: 'Trạng thái', fmt: 'status' }, label: { label: 'Nguồn' }, source: { label: 'Nguồn dữ liệu' },
  material: { label: 'Vật liệu' }, material_code: { label: 'Vật liệu' }, manning_n: { label: 'Hệ số nhám n', fmt: 'num', digits: 3 },
  diameter_mm: { label: 'Đường kính', unit: 'mm', fmt: 'int' }, diameter_m: { label: 'Đường kính hố', unit: 'm', fmt: 'num', digits: 2 },
  rim_elev_m: { label: 'Cao độ nắp', unit: 'm', fmt: 'num' }, invert_elev_m: { label: 'Cao độ đáy', unit: 'm', fmt: 'num' },
  depth_m: { label: 'Chiều sâu', unit: 'm', fmt: 'num' }, up_invert_m: { label: 'Cao độ đáy đầu', unit: 'm', fmt: 'num' },
  down_invert_m: { label: 'Cao độ đáy cuối', unit: 'm', fmt: 'num' }, length_m: { label: 'Chiều dài', unit: 'm', fmt: 'num', digits: 1 },
  slope: { label: 'Độ dốc', fmt: 'slope' }, install_year: { label: 'Năm lắp', fmt: 'text' }, year_built: { label: 'Năm xây', fmt: 'text' },
  capacity_m3s: { label: 'Sức chứa chảy đầy', unit: 'm³/s', fmt: 'num', digits: 3 },
  from_mh: { label: 'Hố ga thượng lưu', fmt: 'int' }, to_mh: { label: 'Hố ga hạ lưu', fmt: 'int' }, from: { label: 'Từ hố ga' }, to: { label: 'Đến hố ga' },
  floors: { label: 'Số tầng', fmt: 'int' }, height_m: { label: 'Chiều cao', unit: 'm', fmt: 'num', digits: 1 }, base_elev_m: { label: 'Cao độ nền', unit: 'm', fmt: 'num' },
  has_basement: { label: 'Tầng hầm', fmt: 'bool' }, area_m2: { label: 'Diện tích', unit: 'm²', fmt: 'num', digits: 0 }, owner: { label: 'Đơn vị quản lý' },
  max_depth_cm: { label: 'Độ sâu ngập', unit: 'cm', fmt: 'int' }, occurred_at: { label: 'Thời điểm', fmt: 'date' }, note: { label: 'Ghi chú' },
  problem: { label: 'Vấn đề' }, cover_up_m: { label: 'Lớp phủ đầu cống', unit: 'm', fmt: 'num' }, cover_down_m: { label: 'Lớp phủ cuối cống', unit: 'm', fmt: 'num' },
  min_cover_m: { label: 'Lớp phủ nhỏ nhất', unit: 'm', fmt: 'num' }, pipe_id: { label: 'ID cống', fmt: 'int' }, pipe_code: { label: 'Cống' },
  pipe_d_mm: { label: 'D cống', unit: 'mm', fmt: 'int' }, utility_id: { label: 'ID CT ngầm', fmt: 'int' }, utility_kind: { label: 'CT ngầm', fmt: 'kind' },
  utility_owner: { label: 'Chủ quản' }, utility_d_mm: { label: 'D CT ngầm', unit: 'mm', fmt: 'int' }, clearance_m: { label: 'Khoảng hở', unit: 'm', fmt: 'num' },
  level: { label: 'Cấp truy vết', fmt: 'int' }, water_level_m: { label: 'Mực nước', unit: 'm', fmt: 'num', digits: 2 }, flood_depth_m: { label: 'Ngập trên nắp', unit: 'm', fmt: 'num' },
  reasons: { label: 'Lý do' }, near_overflow_manholes: { label: 'Hố ga tràn lân cận' }, manhole_id: { label: 'ID hố ga', fmt: 'int' }, manhole_code: { label: 'Hố ga gần nhất' },
  rank: { label: 'Thứ hạng', fmt: 'int' }, distance_m: { label: 'Khoảng cách', unit: 'm', fmt: 'num', digits: 1 },
  q_in_m3s: { label: 'Lưu lượng vào', unit: 'm³/s', fmt: 'num', digits: 3 }, q_cap_m3s: { label: 'Sức chứa', unit: 'm³/s', fmt: 'num', digits: 3 },
  ratio: { label: 'Tỉ lệ tải', fmt: 'pct' }, overloaded: { label: 'Quá tải', fmt: 'bool' }, upstream_manholes: { label: 'Số hố ga thượng lưu', fmt: 'int' },
  catchment_m2: { label: 'Lưu vực', unit: 'm²', fmt: 'num', digits: 0 }, total: { label: 'Tổng', fmt: 'int' }, resolved: { label: 'Đã xử lý', fmt: 'int' },
  open: { label: 'Đang mở', fmt: 'int' }, avg_response_min: { label: 'Phản hồi TB', unit: 'phút', fmt: 'num', digits: 0 },
  avg_resolution_h: { label: 'Xử lý TB', unit: 'giờ', fmt: 'num', digits: 1 }, p90_resolution_h: { label: 'Xử lý P90', unit: 'giờ', fmt: 'num', digits: 1 },
  type: { label: 'Loại lỗi', fmt: 'kind' }, severity: { label: 'Mức độ', fmt: 'int' }, chainage_m: { label: 'Vị trí dọc ống', unit: 'm', fmt: 'num', digits: 1 },
  inspected_at: { label: 'Ngày kiểm tra', fmt: 'date' }, grade: { label: 'Cấp tình trạng', fmt: 'int' },
  asset_type: { label: 'Loại tài sản', fmt: 'kind' }, asset_id: { label: 'ID tài sản', fmt: 'int' }, event_type: { label: 'Sự kiện', fmt: 'kind' },
  detail: { label: 'Chi tiết' }, valid_time: { label: 'Thời điểm thực tế', fmt: 'date' }, tx_time: { label: 'Ghi nhận lúc', fmt: 'date' },
  valid_from: { label: 'Hiệu lực từ', fmt: 'date' }, valid_to: { label: 'Hiệu lực đến', fmt: 'date' }, tx_from: { label: 'Ghi nhận từ', fmt: 'date' }, tx_to: { label: 'Ghi nhận đến', fmt: 'date' },
  step: { label: 'Bước', fmt: 'int' }, offset_m: { label: 'Lý trình', unit: 'm', fmt: 'num', digits: 1 }, rim_from: { label: 'Nắp đầu', unit: 'm', fmt: 'num' }, rim_to: { label: 'Nắp cuối', unit: 'm', fmt: 'num' },
  created_at: { label: 'Tạo lúc', fmt: 'date' }, accepted_at: { label: 'Nhận việc', fmt: 'date' }, arrived_at: { label: 'Có mặt', fmt: 'date' }, resolved_at: { label: 'Hoàn thành', fmt: 'date' },
  zone: { label: 'Khu' }, area_km2: { label: 'Diện tích', unit: 'km²', fmt: 'num', digits: 3 }, image_path: { label: 'Ảnh' },
}

export const VALUE_VI: Record<string, string> = {
  active: 'Hoạt động', maintenance: 'Bảo trì', damaged: 'Hư hỏng', blocked: 'Tắc', retired: 'Ngừng dùng',
  manhole: 'Hố ga', inlet: 'Hố thu', outfall: 'Cửa xả', water: 'Cấp nước', power: 'Điện', telecom: 'Viễn thông',
  crack: 'Nứt', root: 'Rễ cây', deposit: 'Bồi lắng', collapse: 'Sập', pipe: 'Cống', building: 'Công trình', utility: 'CT ngầm',
  inspect: 'Kiểm tra', clean: 'Nạo vét', incident: 'Sự cố', repair: 'Sửa chữa', replace: 'Thay thế',
}

export const fieldLabel = (k: string) => FIELDS[k]?.label ?? k
export const fieldUnit = (k: string) => FIELDS[k]?.unit

const nf = (d: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: 0 })

/** Định dạng giá trị theo từ điển; trả về chuỗi đã kèm đơn vị khi `withUnit` */
export function formatField(k: string, v: unknown, withUnit = true): string {
  if (v === null || v === undefined || v === '') return '—'
  const f = FIELDS[k]
  const unit = withUnit && f?.unit ? ` ${f.unit}` : ''
  if (Array.isArray(v)) return v.map((x) => VALUE_VI[String(x)] ?? String(x)).join(', ')
  switch (f?.fmt) {
    case 'bool': return v ? 'Có' : 'Không'
    case 'date': return new Date(String(v)).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
    case 'pct': return `${nf(0).format(Number(v) * 100)}%`
    case 'slope': return `${nf(2).format(Number(v) * 100)}%`
    case 'int': return nf(0).format(Number(v)) + unit
    case 'num': return nf(f.digits ?? 2).format(Number(v)) + unit
    case 'status': case 'kind': return VALUE_VI[String(v)] ?? String(v)
    default: return typeof v === 'object' ? JSON.stringify(v) : (VALUE_VI[String(v)] ?? String(v)) + unit
  }
}
