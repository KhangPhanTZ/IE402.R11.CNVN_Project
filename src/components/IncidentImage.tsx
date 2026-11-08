import { useSignedUrl } from '@/lib/storage'

export function IncidentImage({ path, className }: { path?: string | null; className?: string }) {
  const { data, error } = useSignedUrl(path)
  if (!path) return null
  if (error) return <span className="text-[10px] text-destructive">Không xem được ảnh: {(error as Error).message}</span>
  return data ? (
    <a href={data} target="_blank" rel="noreferrer">
      <img src={data} alt="Ảnh sự cố" className={className ?? 'h-14 w-20 rounded object-cover'} />
    </a>
  ) : (
    <span className="text-[10px] text-muted-foreground">…</span>
  )
}
