import type { CookieOptions, Request, Response } from 'express'
import { env } from '../../config/env.js'
import {
  DEVICE_COOKIE_MAX_AGE_MS,
  DEVICE_COOKIE_NAME,
  generateDeviceKey,
} from '../../lib/device.js'
import { REFRESH_COOKIE_NAME } from '../../lib/refresh-token.js'

function refreshCookieBaseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
  }
}

function deviceCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
  }
}

/** Sets the refresh cookie; `maxAge` follows absolute `expiresAt` remaining time. */
export function setRefreshCookie(res: Response, refreshToken: string, expiresAt: Date): void {
  const remainingMs = Math.max(0, expiresAt.getTime() - Date.now())
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...refreshCookieBaseOptions(),
    maxAge: remainingMs,
  })
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieBaseOptions())
}

export function getRefreshToken(req: Request): string | undefined {
  return req.cookies?.[REFRESH_COOKIE_NAME]
}

export function getDeviceKey(req: Request): string | undefined {
  const value = req.cookies?.[DEVICE_COOKIE_NAME]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Returns existing device key from cookie, or creates a new one (caller must set cookie). */
export function resolveDeviceKey(req: Request): { deviceKey: string; isNew: boolean } {
  const existing = getDeviceKey(req)
  if (existing) return { deviceKey: existing, isNew: false }
  return { deviceKey: generateDeviceKey(), isNew: true }
}

export function setDeviceCookie(res: Response, deviceKey: string): void {
  res.cookie(DEVICE_COOKIE_NAME, deviceKey, deviceCookieOptions())
}
