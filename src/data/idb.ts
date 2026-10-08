/**
 * Minimal promise wrapper around IndexedDB (no dependency). Falls back to memory.
 *
 * One database per account ("maazan:<user_id>"), so two people sharing a
 * device never see each other's records. "maazan" (no suffix) is the original
 * single-owner / local-mode database; it is only read to offer a one-time
 * import into an account.
 */

const DB_VERSION = 2
export const STORES = ['food', 'exercise', 'health', 'photos'] as const
export type StoreName = (typeof STORES)[number]

export const LEGACY_DB = 'maazan'
export const dbNameFor = (userId: string | null) => (userId ? `maazan:${userId}` : LEGACY_DB)

const handles = new Map<string, Promise<IDBDatabase | null>>()
let current = LEGACY_DB

/** Which database the store reads/writes. */
export function useDatabase(name: string) {
  current = name
}

function open(name: string = current): Promise<IDBDatabase | null> {
  const cached = handles.get(name)
  if (cached) return cached
  const p = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(name, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('food')) db.createObjectStore('food', { keyPath: 'id' }).createIndex('date', 'date')
        if (!db.objectStoreNames.contains('exercise')) db.createObjectStore('exercise', { keyPath: 'id' }).createIndex('date', 'date')
        if (!db.objectStoreNames.contains('health')) db.createObjectStore('health', { keyPath: 'date' })
        // food photos waiting for upload / cached for offline viewing, keyed by storage path
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'path' })
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => {
          db.close()
          handles.delete(name)
        }
        resolve(db)
      }
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  handles.set(name, p)
  return p
}

export async function getAll<T>(store: StoreName, dbName?: string): Promise<T[]> {
  const db = await open(dbName)
  if (!db) return []
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll()
      req.onsuccess = () => resolve(req.result as T[])
      req.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

export async function getOne<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

export async function putMany<T>(store: StoreName, values: T[], dbName?: string): Promise<void> {
  if (!values.length) return
  const db = await open(dbName)
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite')
      const os = tx.objectStore(store)
      for (const v of values) os.put(v)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

export async function deleteOne(store: StoreName, key: string): Promise<void> {
  const db = await open()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

export async function clearAll(dbName?: string): Promise<void> {
  const db = await open(dbName)
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([...STORES].filter((s) => db.objectStoreNames.contains(s)), 'readwrite')
      for (const s of STORES) if (db.objectStoreNames.contains(s)) tx.objectStore(s).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** Remove a whole database (used to clear an account's local copy on logout). */
export async function dropDatabase(name: string): Promise<void> {
  const db = await handles.get(name)
  db?.close()
  handles.delete(name)
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}
