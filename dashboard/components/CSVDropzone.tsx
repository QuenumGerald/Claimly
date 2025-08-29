"use client"
import { useCallback, useState } from 'react'
import { Button } from './ui/Button'

interface CSVData {
  headers: string[]
  rows: string[][]
}

export function CSVDropzone({ onCSVData }: { onCSVData: (data: CSVData, fileName: string) => void }) {
  const [isOver, setOver] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string>('')

  const processCSVFile = useCallback(async (file: File): Promise<CSVData> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const csv = e.target?.result as string
          const lines = csv.split('\n').filter(line => line.trim() !== '')

          if (lines.length === 0) {
            throw new Error('Fichier CSV vide')
          }

          const headers = lines[0].split(',').map(header => header.trim().replace(/"/g, ''))
          const rows = lines.slice(1).map(line =>
            line.split(',').map(cell => cell.trim().replace(/"/g, ''))
          )

          resolve({ headers, rows })
        } catch (err) {
          reject(new Error('Erreur lors du traitement du fichier CSV'))
        }
      }
      reader.onerror = () => reject(new Error('Erreur de lecture du fichier'))
      reader.readAsText(file)
    })
  }, [])

  const validateFile = (file: File): boolean => {
    // Vérifier l'extension
    const allowedExtensions = ['.csv', '.txt']
    const fileName = file.name.toLowerCase()
    const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext))

    // Vérifier le type MIME
    const allowedTypes = ['text/csv', 'text/plain', 'application/csv']
    const hasValidType = allowedTypes.includes(file.type) || file.type === ''

    return hasValidExtension || hasValidType
  }

  const onDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setOver(false)
    setError('')

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    const csvFile = files[0]

    if (!validateFile(csvFile)) {
      setError('Veuillez sélectionner un fichier CSV valide (.csv ou .txt)')
      return
    }

    setIsProcessing(true)
    try {
      const csvData = await processCSVFile(csvFile)
      onCSVData(csvData, csvFile.name)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsProcessing(false)
    }
  }, [processCSVFile, onCSVData])

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    const csvFile = files[0]

    if (!validateFile(csvFile)) {
      setError('Veuillez sélectionner un fichier CSV valide (.csv ou .txt)')
      return
    }

    setIsProcessing(true)
    setError('')
    try {
      const csvData = await processCSVFile(csvFile)
      onCSVData(csvData, csvFile.name)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsProcessing(false)
    }
  }, [processCSVFile, onCSVData])

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          isOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-neutral-300 hover:border-neutral-400'
        } ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
      >
        {isProcessing ? (
          <div className="flex items-center justify-center space-x-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span>Traitement du fichier CSV...</span>
          </div>
        ) : (
          <>
            <div className="mb-2">
              <div className="text-lg font-medium mb-1">📊 Upload CSV</div>
              <div className="text-sm text-neutral-600">
                Glissez-déposez un fichier CSV ici ou cliquez pour sélectionner
              </div>
            </div>
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileInput}
              className="hidden"
              id="csv-file-input"
              disabled={isProcessing}
            />
            <label htmlFor="csv-file-input">
              <Button type="button" disabled={isProcessing}>
                Choisir un fichier CSV
              </Button>
            </label>
          </>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="text-red-800 text-sm font-medium">Erreur :</div>
          <div className="text-red-700 text-sm mt-1">{error}</div>
        </div>
      )}
    </div>
  )
}
