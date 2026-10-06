/** Minimal promise wrapper around IndexedDB (no dependency). Falls back to memory. */

const DB_NAME = 'maazan'
const DB_VERSION = 1
export const STORES = ['food', 'exercise', 'health'] as const
export type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('food')) db.createObjectStore('food', { keyPath: 'id' }).createIndex('date', 'date')
        if (!db.objectStoreNames.contains('exercise')) db.createObjectStore('exercise', { keyPath: 'id' }).createIndex('date', 'date')
        if (!db.objectStoreNames.contains('health')) db.createObjectStore('health', { keyPath: 'date' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await open()
  if (!db) return []
  return new Promise((resolve) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => resolve([])
  })
}

export async function putMany<T>(store: StoreName, values: T[]): Promise<void> {
  if (!values.length) return
  const db = await open()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(store, 'readwrite')
    const os = tx.objectStore(store)
    for (const v of values) os.put(v)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

export async function clearAll(): Promise<void> {
  const db = await open()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction([...STORES], 'readwrite')
    for (const s of STORES) tx.objectStore(s).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}
