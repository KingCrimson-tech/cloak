/**
 * Main-thread bridge to the export worker. Progress is reported through a
 * callback; the final MP4 Blob (and any error) is delivered via the promise.
 */
export function exportToMp4(options, onProgress) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(new URL('./export.worker.js', import.meta.url), {
        type: 'module',
      })
    } catch (error) {
      reject(error)
      return
    }

    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      worker.terminate()
      fn(value)
    }

    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        onProgress?.(data.value, data.label)
      } else if (data.type === 'done') {
        finish(resolve, data.blob)
      } else if (data.type === 'error') {
        finish(reject, new Error(data.message || 'Export failed.'))
      }
    }

    worker.onerror = (event) => {
      finish(reject, new Error(event.message || 'The export worker failed.'))
    }

    worker.postMessage(options)
  })
}

/** Timestamped filename for the download, e.g. cloak-2026-11-16T19-42-10.mp4 */
export function exportFilename(date = new Date()) {
  return `cloak-${date.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.mp4`
}
