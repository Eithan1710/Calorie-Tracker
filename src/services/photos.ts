import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteOne, getAll, getOne, putMany } from '../data/idb'
import { getState, notifyLocalChange } from '../data/store'
import { newId } from '../../supabase/functions/_shared/nutrition.ts'
import { getSupabase } from './supabase'
import { PHOTO_BUCKET } from './config'

/**
 * Food photos.
 *
 *  - Picked from the photo library or camera, compressed on-device (image.ts).
 *  - Each photo belongs to exactly one food entry: entry.photo_path =
 *    "<user_id>/<entry_id>/<photo_id>.jpg". The first path segment is the
 *    owner, which is what the Storage RLS policies check, so a user can only
 *    upload/read/delete under their own folder.
 *  - Saved to IndexedDB first (works offline, instant preview), then uploaded
 *    to the private bucket by the sync engine before the entry row is pushed.
 *  - Shown from the local copy when present; otherwise through a short-lived
 *    signed URL that only the owner's session can create.
 */

interface PhotoRecord {
  path: string
  blob: Blob
  uploaded: boolean
  created_at: string
}

export function newPhotoPath(entryId: string): string {
  return `${getState().userId ?? 'local'}/${entryId}/${newId()}.jpg`
}

const objectUrls = new Map<string, string>()
const signed = new Map<string, { url: string; exp: number }>()
const inflight = new Map<string, Promise<string | null>>()
/** photos that could not be loaded (not uploaded yet from another device, or removed) */
const missing = new Set<string>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

/** Keep a photo locally and queue it for upload. */
export async function savePhoto(path: string, blob: Blob): Promise<void> {
  objectUrls.set(path, URL.createObjectURL(blob))
  await putMany<PhotoRecord>('photos', [{ path, blob, uploaded: false, created_at: new Date().toISOString() }])
  changed()
  notifyLocalChange()
}

/** Remove a photo locally and (best effort) from Storage. */
export async function deletePhoto(path: string | undefined): Promise<void> {
  if (!path) return
  const url = objectUrls.get(path)
  if (url) URL.revokeObjectURL(url)
  objectUrls.delete(path)
  signed.delete(path)
  await deleteOne('photos', path)
  changed()
  const uid = getState().userId
  if (!uid || !path.startsWith(`${uid}/`)) return
  const sb = await getSupabase()
  await sb?.storage.from(PHOTO_BUCKET).remove([path]).catch(() => {})
}

/** Upload every queued photo of the signed-in user. Called by the sync engine before pushing rows. */
export async function uploadPendingPhotos(sb: SupabaseClient, userId: string): Promise<void> {
  const pending = (await getAll<PhotoRecord>('photos')).filter((p) => !p.uploaded && p.path.startsWith(`${userId}/`))
  for (const p of pending) {
    const { error } = await sb.storage.from(PHOTO_BUCKET).upload(p.path, p.blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
    // a photo that can't be uploaded right now stays queued; it must never block syncing the meals themselves
    if (error) {
      console.warn('photo upload failed, will retry', error.message)
      continue
    }
    await putMany<PhotoRecord>('photos', [{ ...p, uploaded: true }])
  }
}

async function resolveUrl(path: string): Promise<string | null> {
  const local = await getOne<PhotoRecord>('photos', path)
  if (local) {
    const url = URL.createObjectURL(local.blob)
    objectUrls.set(path, url)
    return url
  }
  const uid = getState().userId
  if (!uid || !path.startsWith(`${uid}/`)) return null
  const sb = await getSupabase()
  if (!sb) return null
  const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, 60 * 60)
  if (error || !data?.signedUrl) {
    missing.add(path)
    changed()
    return null
  }
  missing.delete(path)
  signed.set(path, { url: data.signedUrl, exp: Date.now() + 55 * 60_000 })
  return data.signedUrl
}

function cachedUrl(path: string): string | null {
  const local = objectUrls.get(path)
  if (local) return local
  const s = signed.get(path)
  return s && s.exp > Date.now() ? s.url : null
}

/** URL to display an entry's photo (local copy first, then a signed URL). */
export function usePhotoUrl(path: string | undefined): string | null {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  const url = path ? cachedUrl(path) : null
  useEffect(() => {
    if (!path || url || missing.has(path)) return
    let p = inflight.get(path)
    if (!p) {
      p = resolveUrl(path).finally(() => inflight.delete(path))
      inflight.set(path, p)
    }
    let alive = true
    void p.then((u) => {
      if (alive && u) force((n) => n + 1)
    })
    return () => {
      alive = false
    }
  }, [path, url])
  return url
}

/** True when an entry's photo couldn't be loaded (e.g. still uploading from another device). */
export function photoUnavailable(path: string | undefined): boolean {
  return Boolean(path && missing.has(path))
}
