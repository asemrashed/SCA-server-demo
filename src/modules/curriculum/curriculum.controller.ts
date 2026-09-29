import type { Request, Response, NextFunction } from 'express'
import type { Role } from '../../shared/enums.js'
import * as curriculumSync from './curriculum-sync.js'

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value
}

export async function previewCascadeDelete(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await curriculumSync.getCascadeDeletePreview(req.query as never)
    res.json({ data })
  } catch (err) {
    next(err)
  }
}

export async function removeSubject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await curriculumSync.cascadeDeleteSubject(
      req.auth!.role as Role,
      param(req.params.subjectId),
      req.body?.confirm,
    )
    res.json({ data })
  } catch (err) {
    next(err)
  }
}

export async function removeModule(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await curriculumSync.cascadeDeleteModule(
      req.auth!.role as Role,
      param(req.params.moduleId),
      req.body?.confirm,
    )
    res.json({ data })
  } catch (err) {
    next(err)
  }
}

export async function removeLesson(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await curriculumSync.cascadeDeleteLesson(
      req.auth!.role as Role,
      param(req.params.lessonId),
      req.body?.confirm,
    )
    res.json({ data })
  } catch (err) {
    next(err)
  }
}
