/** Diễn giải lỗi trả về từ CSDL thành thông điệp cho người dùng (vẫn giữ nguyên văn để tra cứu) */
export interface HumanError {
  kind: 'topology' | 'rls' | 'versioning' | 'auth' | 'network' | 'other'
  tone: 'danger' | 'warning'
  title: string
  message: string
  raw: string
}

export function humanizeError(raw: string): HumanError {
  const msg = raw.replace(/^(TOPOLOGY|RLS|VERSIONING):\s*/, '')
  if (raw.startsWith('TOPOLOGY'))
    return { kind: 'topology', tone: 'warning', title: 'Vi phạm ràng buộc topology', message: msg.charAt(0).toUpperCase() + msg.slice(1), raw }
  if (raw.startsWith('RLS') || /row-level security|permission denied/i.test(raw))
    return {
      kind: 'rls', tone: 'danger', title: 'Bạn không có quyền thực hiện thao tác này',
      message: /khu phụ trách|zone/i.test(raw)
        ? 'Tài sản nằm ngoài khu bạn phụ trách. Hãy liên hệ kỹ thuật viên của khu đó hoặc quản trị viên.'
        : /phân tích/i.test(raw) ? 'Chức năng phân tích chỉ dành cho kỹ thuật viên và quản trị viên.'
        : 'Chính sách bảo mật (RLS) của CSDL đã từ chối yêu cầu.',
      raw,
    }
  if (raw.startsWith('VERSIONING'))
    return { kind: 'versioning', tone: 'warning', title: 'Không sửa được bản lịch sử', message: 'Chỉ bản ghi hiện hành mới được chỉnh sửa; các phiên bản cũ là bất biến.', raw }
  if (/invalid login|credentials/i.test(raw))
    return { kind: 'auth', tone: 'danger', title: 'Sai email hoặc mật khẩu', message: 'Kiểm tra lại thông tin đăng nhập.', raw }
  if (/failed to fetch|network|ECONN/i.test(raw))
    return { kind: 'network', tone: 'danger', title: 'Không kết nối được máy chủ', message: 'Kiểm tra Supabase đã chạy và cấu hình VITE_SUPABASE_URL.', raw }
  return { kind: 'other', tone: 'danger', title: 'Có lỗi xảy ra', message: msg, raw }
}
