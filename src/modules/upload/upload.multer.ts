import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import { MAX_UPLOAD_BYTES } from '../../shared/constants.js'
import { storageProvider, uploadDir } from '../../config/env.js'

const ALLOWED_FOLDERS = new Set(['images', 'videos', 'documents', 'files'])

export function safeFilename(originalname: string): string {
  return originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

export function buildUploadKey(folder: string, originalname: string): string {
  const normalizedFolder = ALLOWED_FOLDERS.has(folder) ? folder : 'files'
  return `${normalizedFolder}/${Date.now()}-${safeFilename(originalname)}`
}

const diskStorage = multer.diskStorage({
  destination(req, _file, cb) {
    const folder = String(req.body?.folder ?? 'files')
    const dest = ALLOWED_FOLDERS.has(folder)
      ? path.join(uploadDir(), folder)
      : path.join(uploadDir(), 'files')
    fs.mkdir(dest, { recursive: true }, (err) => cb(err, dest))
  },
  filename(_req, file, cb) {
    cb(null, `${Date.now()}-${safeFilename(file.originalname)}`)
  },
})

export const uploadMiddleware = multer({
  storage: storageProvider() === 'cloudinary' ? multer.memoryStorage() : diskStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
})
