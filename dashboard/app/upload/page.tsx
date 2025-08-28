"use client"
import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Dropzone } from '@/components/Dropzone'
import { uploadFile } from '@/lib/api'

export default function UploadPage() {
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080')
  const [token, setToken] = useState('')
  const [orgId, setOrgId] = useState('')
  const [logs, setLogs] = useState<string>('')

  async function handleFiles(files: File[]) {
    for (const f of files) {
      try {
        const res = await uploadFile({ baseUrl, token, orgId }, f)
        setLogs((l) => l + `\nUploaded ${f.name}: ${JSON.stringify(res)}`)
      } catch (e: any) {
        setLogs((l) => l + `\nError ${f.name}: ${e.message}`)
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Input placeholder="Gateway URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <Input placeholder="JWT" value={token} onChange={(e) => setToken(e.target.value)} />
        <Input placeholder="Org ID" value={orgId} onChange={(e) => setOrgId(e.target.value)} />
      </div>
      <Dropzone onFiles={handleFiles} />
      <pre className="text-xs bg-neutral-100 p-3 rounded-md whitespace-pre-wrap">{logs}</pre>
    </div>
  )
}
