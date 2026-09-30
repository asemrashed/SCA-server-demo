import path from 'node:path'
import { z } from 'zod'

const storageProviderSchema = z.enum(['cloudinary', 'vps']).default('cloudinary')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  /** Refresh TTL when login includes remember: true (or register). */
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  /** Refresh TTL when login omits remember / remember: false. */
  JWT_REFRESH_SESSION_EXPIRES_IN: z.string().default('1d'),
  CORS_ORIGIN: z.string().min(1),
  STORAGE_PROVIDER: storageProviderSchema,
  ADMIN_WHATSAPP_PHONE: z.string().min(10).optional(),
  /** Frontend base URL for password-reset links (no trailing slash). */
  CLIENT_URL: z.string().url().default('http://localhost:3000'),
  /** How long password-reset links stay valid. */
  PASSWORD_RESET_EXPIRES_IN: z.string().default('1h'),
  /** SMTP — Gmail app password for adminsharifca@gmail.com */
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().email().default('adminsharifca@gmail.com'),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('SCA <adminsharifca@gmail.com>'),
  /** Display name used in transactional emails. */
  PLATFORM_NAME: z.string().default('SCA'),
  /** Absolute or relative path where uploaded files are stored on disk. */
  UPLOAD_DIR: z.string().default('./uploads'),
  /** Cloudinary credentials used when STORAGE_PROVIDER=cloudinary. */
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
  /**
   * Public base URL for uploaded files (no trailing slash).
   * e.g. https://api.sharifcommerceacademy.com/uploads
   */
  PUBLIC_UPLOAD_BASE_URL: z.string().url().optional(),
})

export type Env = z.infer<typeof envSchema>
export type StorageProvider = z.infer<typeof storageProviderSchema>

export function validateStorageEnv(data: Partial<Env>): void {
  const storageProvider = data.STORAGE_PROVIDER ?? 'cloudinary'

  if (storageProvider === 'cloudinary') {
    const missing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']
      .filter((key) => !data[key as keyof typeof data])

    if (missing.length > 0) {
      throw new Error(
        `Invalid environment: ${missing.join(', ')} is required when STORAGE_PROVIDER=cloudinary`,
      )
    }
  }

  if (data.NODE_ENV === 'production' && storageProvider === 'vps' && !data.PUBLIC_UPLOAD_BASE_URL) {
    throw new Error('Invalid environment: PUBLIC_UPLOAD_BASE_URL is required in production when STORAGE_PROVIDER=vps')
  }
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid environment: ${issues}`)
  }
  const data = parsed.data
  validateStorageEnv(data)
  return data
}

export const env = loadEnv()

/** Comma-separated CORS_ORIGIN — e.g. `https://www.example.com,https://example.com` */
export function corsOrigins(): string[] {
  return env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

/** Resolved absolute directory for file uploads. */
export function uploadDir(): string {
  return path.isAbsolute(env.UPLOAD_DIR)
    ? env.UPLOAD_DIR
    : path.resolve(process.cwd(), env.UPLOAD_DIR)
}

/** Base URL returned in upload API responses (no trailing slash). */
export function publicUploadBaseUrl(): string {
  if (env.PUBLIC_UPLOAD_BASE_URL) {
    return env.PUBLIC_UPLOAD_BASE_URL.replace(/\/$/, '')
  }

  if (env.STORAGE_PROVIDER === 'cloudinary' && env.CLOUDINARY_CLOUD_NAME) {
    return `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}`
  }

  return `http://localhost:${env.PORT}/uploads`
}

export function storageProvider(): StorageProvider {
  return env.STORAGE_PROVIDER
}

export function cloudinaryConfig() {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new Error('Invalid environment: Cloudinary credentials are required when STORAGE_PROVIDER=cloudinary')
  }

  return {
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  }
}

/** Admin WhatsApp number for manual monthly fee requests (digits only, BD format). */
export function adminWhatsappPhone(): string {
  return env.ADMIN_WHATSAPP_PHONE ?? '01638149875'
}
