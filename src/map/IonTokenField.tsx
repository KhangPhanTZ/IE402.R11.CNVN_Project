/** Ô nhập token Cesium ion để bật Cesium World Terrain (token lưu trong trình duyệt, không gửi lên máy chủ dự án) */
import { useState, useSyncExternalStore } from 'react'
import { Check, ExternalLink, KeyRound, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { checkIonToken, getIonToken, ionTokenFromUser, setIonToken, subscribeIonToken } from './cesiumUtil'

export function useIonToken() {
  return useSyncExternalStore(subscribeIonToken, getIonToken)
}

export function IonTokenField({ onSaved, onCleared }: { onSaved?: () => void; onCleared?: () => void }) {
  const token = useIonToken()
  const fromUser = useSyncExternalStore(subscribeIonToken, ionTokenFromUser)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const t = value.trim()
    if (!t) return
    setBusy(true)
    setError(null)
    const err = await checkIonToken(t)
    setBusy(false)
    if (err) return setError(err)
    setIonToken(t)
    setValue('')
    setEditing(false)
    onSaved?.()
  }

  if (token && !editing) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs">
        <KeyRound className="size-3.5 shrink-0 text-success" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          Token Cesium ion: <span className="font-mono">…{token.slice(-6)}</span>{fromUser ? '' : ' (cấu hình sẵn)'}
        </span>
        <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>Đổi</Button>
        {fromUser && (
          <Button size="xs" variant="ghost" aria-label="Xoá token" onClick={() => { setIonToken(null); onCleared?.() }}><Trash2 /></Button>
        )}
      </div>
    )
  }
  return (
    <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); save() }}>
      <label htmlFor="ion-token" className="text-xs font-medium text-muted-foreground">Token Cesium ion (để dùng World Terrain)</label>
      <div className="flex gap-1.5">
        <Input id="ion-token" type="password" autoComplete="off" spellCheck={false} placeholder="Dán access token…"
          value={value} onChange={(e) => { setValue(e.target.value); setError(null) }} aria-invalid={!!error} className="font-mono text-xs" />
        <Button type="submit" size="sm" disabled={!value.trim() || busy}>{busy ? 'Đang kiểm tra…' : <><Check /> Lưu</>}</Button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : (
        <p className="text-xs text-subtle">
          Lấy token miễn phí tại{' '}
          <a className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2" href="https://ion.cesium.com/tokens" target="_blank" rel="noreferrer">
            ion.cesium.com/tokens <ExternalLink className="size-3" aria-hidden />
          </a>. Token chỉ lưu trong trình duyệt này.
        </p>
      )}
      {editing && <Button type="button" size="xs" variant="ghost" onClick={() => { setEditing(false); setError(null) }}>Huỷ</Button>}
    </form>
  )
}
