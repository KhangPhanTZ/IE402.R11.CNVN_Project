export const KIND_VI: Record<string, string> = {
  blocked: 'Tắc nghẽn', overflow: 'Trào nước', broken_cover: 'Vỡ/mất nắp', odor: 'Mùi hôi', subsidence: 'Lún sụt', other: 'Khác',
}
export const STATUS_VI: Record<string, string> = {
  new: 'Mới', accepted: 'Đã nhận', in_progress: 'Đang xử lý (đã đến)', resolved: 'Đã xử lý', rejected: 'Từ chối',
}
export const STATUS_VARIANT: Record<string, 'destructive' | 'warning' | 'secondary' | 'success' | 'outline'> = {
  new: 'destructive', accepted: 'warning', in_progress: 'secondary', resolved: 'success', rejected: 'outline',
}
