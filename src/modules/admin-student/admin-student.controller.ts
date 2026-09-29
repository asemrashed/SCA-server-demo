import type { Request, Response, NextFunction } from 'express'
import * as adminStudentService from './admin-student.service.js'

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await adminStudentService.listAdminStudents(req.query as never)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const student = await adminStudentService.createAdminStudent(req.body)
    res.status(201).json({ data: student })
  } catch (err) {
    next(err)
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const student = await adminStudentService.updateAdminStudent(param(req.params.id), req.body)
    res.json({ data: student })
  } catch (err) {
    next(err)
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await adminStudentService.deleteAdminStudent(param(req.params.id))
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

export async function setEnrollmentBlock(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const item = await adminStudentService.setEnrollmentBlocked(
      param(req.params.enrollmentId),
      req.body.blocked,
    )
    res.json({ data: item })
  } catch (err) {
    next(err)
  }
}

export async function listBoundDevices(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await adminStudentService.listBoundDevices(param(req.params.id))
    res.json({ data })
  } catch (err) {
    next(err)
  }
}


export async function removeBoundDevice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await adminStudentService.removeBoundDevice(
      param(req.params.id),
      param(req.params.deviceId),
    )
    res.json({ data })
  } catch (err) {
    next(err)
  }
}
