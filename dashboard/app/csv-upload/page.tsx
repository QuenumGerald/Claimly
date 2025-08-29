"use client"
import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { CSVDropzone } from '@/components/CSVDropzone'
import { uploadFile } from '@/lib/api'

interface CSVData {
  headers: string[]
  rows: string[][]
}

export default function CSVUploadPage() {
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080')
  const [token, setToken] = useState('')
  const [orgId, setOrgId] = useState('')
  const [csvData, setCsvData] = useState<CSVData | null>(null)
  const [fileName, setFileName] = useState('')
  const [logs, setLogs] = useState<string>('')
  const [isUploading, setIsUploading] = useState(false)

  const handleCSVData = (data: CSVData, name: string) => {
    setCsvData(data)
    setFileName(name)
    setLogs(`✅ Fichier CSV chargé : ${name}\n📊 ${data.rows.length} lignes, ${data.headers.length} colonnes\n\nColonnes : ${data.headers.join(', ')}`)
  }

  const uploadToServer = async () => {
    if (!csvData || !fileName) return

    setIsUploading(true)
    try {
      // Créer un fichier CSV à partir des données
      const csvContent = [
        csvData.headers.join(','),
        ...csvData.rows.map(row => row.join(','))
      ].join('\n')

      const csvBlob = new Blob([csvContent], { type: 'text/csv' })
      const csvFile = new File([csvBlob], fileName, { type: 'text/csv' })

      const res = await uploadFile({ baseUrl, token, orgId }, csvFile)
      setLogs(prev => prev + `\n\n✅ Upload réussi : ${JSON.stringify(res, null, 2)}`)
    } catch (e: any) {
      setLogs(prev => prev + `\n\n❌ Erreur upload : ${e.message}`)
    } finally {
      setIsUploading(false)
    }
  }

  const exportCSV = () => {
    if (!csvData || !fileName) return

    const csvContent = [
      csvData.headers.join(','),
      ...csvData.rows.map(row => row.join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">📊 Upload CSV</h1>
        <p className="text-neutral-600">
          Uploadez un fichier CSV pour analyser et traiter vos données
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Input
          placeholder="Gateway URL"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <Input
          placeholder="JWT Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <Input
          placeholder="Org ID"
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
        />
      </div>

      <CSVDropzone onCSVData={handleCSVData} />

      {csvData && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Données CSV : {fileName}</h2>
            <div className="flex space-x-2">
              <Button
                onClick={exportCSV}
                className="bg-green-600 hover:bg-green-700"
              >
                📥 Exporter CSV
              </Button>
              <Button
                onClick={uploadToServer}
                disabled={isUploading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isUploading ? '⏳ Upload...' : '☁️ Uploader'}
              </Button>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">#</th>
                    {csvData.headers.map((header, i) => (
                      <th key={i} className="px-3 py-2 text-left font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {csvData.rows.slice(0, 10).map((row, i) => (
                    <tr key={i} className="hover:bg-neutral-50">
                      <td className="px-3 py-2 text-neutral-500 font-mono">
                        {i + 1}
                      </td>
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-2 max-w-xs truncate">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {csvData.rows.length > 10 && (
              <div className="p-3 bg-neutral-50 text-center text-sm text-neutral-600">
                ... et {csvData.rows.length - 10} lignes supplémentaires
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-blue-50 p-3 rounded-lg">
              <div className="font-medium text-blue-800">📊 Statistiques</div>
              <div className="text-blue-700 mt-1">
                <div>Lignes : {csvData.rows.length}</div>
                <div>Colonnes : {csvData.headers.length}</div>
              </div>
            </div>
            <div className="bg-green-50 p-3 rounded-lg">
              <div className="font-medium text-green-800">✅ État</div>
              <div className="text-green-700 mt-1">
                <div>Fichier chargé</div>
                <div>Prêt pour traitement</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {logs && (
        <div className="space-y-2">
          <h3 className="font-medium">Logs :</h3>
          <pre className="text-xs bg-neutral-100 p-3 rounded-md whitespace-pre-wrap max-h-40 overflow-y-auto">
            {logs}
          </pre>
        </div>
      )}
    </div>
  )
}
