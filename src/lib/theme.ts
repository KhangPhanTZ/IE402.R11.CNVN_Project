/**
 * MÀU NGỮ NGHĨA CHO BẢN ĐỒ – một nguồn duy nhất (thay cho các mã hex rải rác).
 * Nguyên tắc: ở chế độ mặc định tô theo TRẠNG THÁI (tông lạnh, bão hoà vừa);
 * khi có kết quả phân tích, mọi đối tượng khác bị làm mờ và chỉ kết quả được tô bằng
 * bảng màu PHÂN TÍCH (tông nóng, bão hoà cao) ⇒ hai hệ màu không bao giờ lẫn nhau.
 */
export const STATUS = {
  active: { color: '#2563eb', label: 'Hoạt động' },
  maintenance: { color: '#ca8a04', label: 'Bảo trì' },
  damaged: { color: '#9f1239', label: 'Hư hỏng' },
  blocked: { color: '#6d28d9', label: 'Tắc' },
  retired: { color: '#94a3b8', label: 'Ngừng dùng' },
} as const

export const KIND = {
  manhole: { color: '#334155', label: 'Hố ga' },
  inlet: { color: '#0891b2', label: 'Hố thu' },
  outfall: { color: '#15803d', label: 'Cửa xả' },
} as const

export const UTILITY = {
  water: { color: '#0ea5e9', label: 'Cấp nước' },
  power: { color: '#f43f5e', label: 'Điện lực' },
  telecom: { color: '#10b981', label: 'Viễn thông' },
} as const

/** Bảng màu kết quả phân tích */
export const ANALYSIS = {
  critical: '#dc2626', // lỗi nghiêm trọng: dốc ngược, va chạm, hố ga tràn, quá tải
  warning: '#ea580c',  // cảnh báo: chôn nông, nhà bị ảnh hưởng
  caution: '#eab308',  // gần ngưỡng
  ok: '#16a34a',       // đạt
  focus: '#111827',    // đối tượng gốc của phân tích (cống bị tắc…)
  upstream: '#7c3aed',
  downstream: '#0891b2',
  route: '#db2777',    // tuyến mặt cắt
  marker: '#facc15',   // điểm đánh dấu (va chạm, KNN)
  dim: '#cbd5e1',      // đối tượng không thuộc kết quả
} as const

export const SEVERITY = ['#16a34a', '#84cc16', '#eab308', '#f97316', '#dc2626'] as const

export const INCIDENT = {
  new: { color: '#dc2626', label: 'Mới', badge: 'destructive' },
  accepted: { color: '#d97706', label: 'Đã nhận', badge: 'warning' },
  in_progress: { color: '#7c3aed', label: 'Đang xử lý', badge: 'violet' },
  resolved: { color: '#16a34a', label: 'Đã xử lý', badge: 'success' },
  rejected: { color: '#64748b', label: 'Từ chối', badge: 'secondary' },
} as const

export const BUILDING = { normal: '#e2e8f0', basement: '#c7d2fe', outline: '#94a3b8' } as const

export const ratioColor = (r: number) => (r >= 1 ? ANALYSIS.critical : r >= 0.8 ? ANALYSIS.warning : r >= 0.5 ? ANALYSIS.caution : ANALYSIS.ok)
