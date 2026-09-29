import type { Request, Response, NextFunction } from 'express'
import * as authService from './auth.service.js'
import {
  clearRefreshCookie,
  getDeviceKey,
  getRefreshToken,
  resolveDeviceKey,
  setDeviceCookie,
  setRefreshCookie,
} from './auth.cookies.js'

function deviceContextFromRequest(req: Request): authService.DeviceContext {
  const { deviceKey } = resolveDeviceKey(req)
  const ua = req.headers['user-agent']
  return {
    deviceKey,
    userAgent: typeof ua === 'string' ? ua : undefined,
    ip: req.ip,
  }
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const device = deviceContextFromRequest(req)
    const session = await authService.register(req.body, device)
    setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt)
    if (session.deviceKey) setDeviceCookie(res, session.deviceKey)
    res.status(201).json({ data: authService.toAuthResponse(session) })
  } catch (err) {
    next(err)
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const device = deviceContextFromRequest(req)
    const session = await authService.login(req.body, device)
    setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt)
    if (session.deviceKey) setDeviceCookie(res, session.deviceKey)
    res.json({ data: authService.toAuthResponse(session) })
  } catch (err) {
    next(err)
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = getRefreshToken(req)
    if (!token) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Refresh token required' },
      })
      return
    }
    const session = await authService.refresh(token)
    setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt)
    const deviceKey = getDeviceKey(req)
    if (deviceKey) setDeviceCookie(res, deviceKey)
    res.json({ data: authService.toAuthResponse(session) })
  } catch (err) {
    next(err)
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.logout(getRefreshToken(req))
    clearRefreshCookie(res)
    // Keep sca_device cookie so the same browser stays bound after logout.
    res.json({ data: { success: true } })
  } catch (err) {
    next(err)
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.getMe(req.auth!.userId)
    res.json({ data: user })
  } catch (err) {
    next(err)
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.updateMe(req.auth!.userId, req.body)
    res.json({ data: user })
  } catch (err) {
    next(err)
  }
}

export async function requestPasswordReset(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await authService.requestPasswordReset(req.body)
    res.json({ data: result })
  } catch (err) {
    next(err)
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.resetPassword(req.body)
    res.json({ data: result })
  } catch (err) {
    next(err)
  }
}
