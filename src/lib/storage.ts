import fs from 'node:fs/promises'
import path from 'node:path'
import { v2 as cloudinary } from 'cloudinary'
import { cloudinaryConfig, publicUploadBaseUrl, storageProvider, uploadDir } from '../config/env.js'

export interface StorageUploadResult {
  url: string
  key: string
}

export interface StorageClient {
  upload(key: string, data: Buffer, contentType: string): Promise<StorageUploadResult>
  delete(key: string): Promise<void>
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>
}

function normalizeStorageKey(key: string): string {
  return key.replace(/^\/+/, '').replace(/\\/g, '/').replace(/\.\./g, '')
}

class LocalStorage implements StorageClient {
  private readonly root: string
  private readonly baseUrl: string

  constructor(root: string, baseUrl: string) {
    this.root = root
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  private filePath(key: string): string {
    const normalized = normalizeStorageKey(key)
    return path.join(this.root, normalized)
  }

  private publicUrl(key: string): string {
    const normalized = normalizeStorageKey(key)
    return `${this.baseUrl}/${normalized.split('/').map(encodeURIComponent).join('/')}`
  }

  async upload(key: string, data: Buffer, _contentType: string): Promise<StorageUploadResult> {
    const filePath = this.filePath(key)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, data)
    return { url: this.publicUrl(key), key }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(key))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  async getSignedUrl(key: string, _expiresInSeconds = 3600): Promise<string> {
    return this.publicUrl(key)
  }
}

class CloudinaryStorage implements StorageClient {
  async upload(key: string, data: Buffer, contentType: string): Promise<StorageUploadResult> {
    const normalized = normalizeStorageKey(key)
    const folder = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : undefined
    const publicId = normalized.includes('/') ? normalized.slice(normalized.lastIndexOf('/') + 1) : normalized
    const resourceType = contentType.startsWith('video/') ? 'video' : contentType.startsWith('image/') ? 'image' : 'auto'

    const result = await new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId.replace(/\.[^/.]+$/, ''),
          resource_type: resourceType,
          overwrite: false,
          unique_filename: true,
          type: 'upload',
        },
        (error, uploaded) => {
          if (error) return reject(error)
          resolve(uploaded)
        },
      )

      uploadStream.end(data)
    })

    return {
      url: result.secure_url ?? result.url,
      key: result.public_id ?? normalized,
    }
  }

  async delete(key: string): Promise<void> {
    await cloudinary.uploader.destroy(normalizeStorageKey(key))
  }

  async getSignedUrl(key: string, _expiresInSeconds = 3600): Promise<string> {
    return cloudinary.url(normalizeStorageKey(key), { secure: true, type: 'upload' })
  }
}

function buildStorage(): StorageClient {
  if (storageProvider() === 'cloudinary') {
    cloudinary.config(cloudinaryConfig())
    return new CloudinaryStorage()
  }

  return new LocalStorage(uploadDir(), publicUploadBaseUrl())
}

export const storage: StorageClient = buildStorage()

/** Public URL for a storage key under UPLOAD_DIR. */
export function publicUrlForKey(key: string): string {
  const normalized = normalizeStorageKey(key)

  if (storageProvider() === 'cloudinary') {
    return cloudinary.url(normalized, { secure: true, type: 'upload' })
  }

  const base = publicUploadBaseUrl()
  return `${base}/${normalized.split('/').map(encodeURIComponent).join('/')}`
}

/** Absolute path for a storage key. */
export function absolutePathForKey(key: string): string {
  const normalized = normalizeStorageKey(key)
  return path.join(uploadDir(), normalized)
}

/** Save a buffer to disk and return its public URL (used by migration scripts). */
export async function saveLocalFile(key: string, data: Buffer): Promise<StorageUploadResult> {
  return storage.upload(key, data, 'application/octet-stream')
}

/** True when a URL points at this server's upload storage. */
export function isLocalUploadUrl(url: string): boolean {
  try {
    const base = new URL(publicUploadBaseUrl())
    const target = new URL(url)
    return target.origin === base.origin && target.pathname.startsWith(`${base.pathname}/`)
  } catch {
    return false
  }
}

/** Map a Cloudinary URL to the local storage key used under UPLOAD_DIR. */
export function localKeyFromCloudinaryUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.includes('res.cloudinary.com')) return null

    const match = parsed.pathname.match(/\/(?:image|video|raw)\/upload\/(?:v\d+\/)?(.+)/)
    if (!match) return null

    let storagePath = decodeURIComponent(match[1])
    if (storagePath.startsWith('sca/')) {
      storagePath = storagePath.slice(4)
    }
    return storagePath
  } catch {
    return null
  }
}
