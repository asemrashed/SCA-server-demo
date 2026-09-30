import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const baseEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?sslmode=require',
  JWT_ACCESS_SECRET: '1234567890abcdef1234567890abcdef',
  JWT_REFRESH_SECRET: 'abcdef1234567890abcdef1234567890',
  CORS_ORIGIN: 'http://localhost:3000',
}

async function importEnv() {
  const url = new URL('./env.js', import.meta.url).href + `?t=${Date.now()}`
  return import(url)
}

describe('storage env validation', () => {
  it('accepts cloudinary storage with required credentials', async () => {
    Object.assign(process.env, baseEnv, {
      STORAGE_PROVIDER: 'cloudinary',
      CLOUDINARY_CLOUD_NAME: 'demo-cloud',
      CLOUDINARY_API_KEY: 'demo-key',
      CLOUDINARY_API_SECRET: 'demo-secret',
    })

    const { validateStorageEnv } = await importEnv()

    assert.doesNotThrow(() =>
      validateStorageEnv({
        NODE_ENV: 'production',
        STORAGE_PROVIDER: 'cloudinary',
        CLOUDINARY_CLOUD_NAME: 'demo-cloud',
        CLOUDINARY_API_KEY: 'demo-key',
        CLOUDINARY_API_SECRET: 'demo-secret',
      }),
    )

    assert.equal(validateStorageEnv.name, 'validateStorageEnv')
  })

  it('requires PUBLIC_UPLOAD_BASE_URL for vps storage in production', async () => {
    Object.assign(process.env, baseEnv, {
      STORAGE_PROVIDER: 'vps',
      UPLOAD_DIR: './uploads',
    })

    await assert.rejects(importEnv(), /PUBLIC_UPLOAD_BASE_URL is required in production/i)
  })
})
