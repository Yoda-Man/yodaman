import { useRef, useState } from 'react'
import { File, Loader2, Paperclip, X } from 'lucide-react'
import { api } from '../src/api/api'

const ACCEPTED_UPLOAD_TYPES = '.dart,.js,.ts,.json,.yaml,.md,.log,.txt'

function displaySize(size) {
  return `${Math.max(1, Math.round(Number(size || 0) / 1024))} KB`
}

export default function FileUploader({ files = [], onFilesChange, disabled = false }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function uploadFiles(event) {
    const selectedFiles = Array.from(event.target.files || [])
    event.target.value = ''
    if (!selectedFiles.length) return

    setUploading(true)
    setError('')
    try {
      const uploaded = []
      for (const file of selectedFiles) {
        uploaded.push(await api.uploadTempFile(file))
      }
      const existingIds = new Set(files.map(file => file.fileId))
      onFilesChange([
        ...files,
        ...uploaded.filter(file => !existingIds.has(file.fileId))
      ])
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function removeFile(fileId) {
    onFilesChange(files.filter(file => file.fileId !== fileId))
    try {
      await api.deleteTempUploadFile(fileId)
    } catch {
      // The file may already have been attached to a task or cleaned up by TTL.
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".dart,.js,.ts,.json,.yaml,.md,.log,.txt"
          onChange={uploadFiles}
          className="hidden"
          disabled={disabled || uploading}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white disabled:opacity-40"
          title="Attach local files"
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
        </button>
        {error ? <span className="max-w-56 truncate text-xs text-rose-200">{error}</span> : null}
      </div>

      {files.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {files.map(file => (
            <div key={file.fileId} className="inline-flex max-w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-slate-300">
              <File size={13} className="shrink-0 text-slate-500" />
              <span className="max-w-44 truncate">{file.filename}</span>
              <span className="shrink-0 text-[10px] text-slate-500">{displaySize(file.size)}</span>
              <button
                type="button"
                onClick={() => removeFile(file.fileId)}
                className="shrink-0 text-slate-500 hover:text-rose-200"
                title="Remove attached file"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-2 text-[10px] text-slate-600">Files are stored locally only.</div>
    </div>
  )
}

export { ACCEPTED_UPLOAD_TYPES }
