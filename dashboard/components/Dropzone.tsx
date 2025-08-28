"use client"
import { useCallback, useState } from 'react'
import { Button } from './ui/Button'

export function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [isOver, setOver] = useState(false)
  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onFiles(files)
  }, [onFiles])
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`border-2 border-dashed rounded-lg p-6 text-center ${isOver ? 'border-black' : 'border-neutral-300'}`}
    >
      <div className="mb-2">Glissez-déposez des documents ici</div>
      <input type="file" multiple onChange={(e) => onFiles(Array.from(e.target.files || []))} className="hidden" id="file-input" />
      <label htmlFor="file-input">
        <Button type="button">Choisir des fichiers</Button>
      </label>
    </div>
  )
}
