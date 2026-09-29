import { randomBytes } from 'node:crypto'
import { DeviceType } from '../shared/enums.js'

export const DEVICE_COOKIE_NAME = 'sca_device'

/** Chrome caps persistent cookies at ~400 days; renew on each successful login. */
export const DEVICE_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000

export function generateDeviceKey(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Coarse mobile vs desktop from User-Agent. Tablets count as mobile.
 * Best-effort only — browsers do not expose MAC addresses.
 */
export function classifyDeviceType(userAgent: string | undefined): DeviceType {
  const ua = userAgent ?? ''
  if (
    /iPhone|iPod|iPad|Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(ua)
  ) {
    return DeviceType.MOBILE
  }
  return DeviceType.DESKTOP
}
