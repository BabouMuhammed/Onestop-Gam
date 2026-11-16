import { Download } from 'lucide-react'
import { useState } from 'react'
import { downloadCsv } from '../api'
import { Button, useNotify } from '../ui'

/** "Export CSV" for a list page. Exports what the list shows with its current filters, up to 10,000 rows. */
export function ExportButton({ path, division }: { path: string; division?: string | 'all' }) {
  const notify = useNotify()
  const [busy, setBusy] = useState(false)
  return (
    <Button
      icon={<Download className="size-4" aria-hidden />}
      busy={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await downloadCsv(path, { division })
        } catch (error) {
          notify(error instanceof Error ? error.message : 'The export failed')
        } finally {
          setBusy(false)
        }
      }}
    >
      Export CSV
    </Button>
  )
}
