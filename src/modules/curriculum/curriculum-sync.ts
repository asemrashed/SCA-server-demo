import type { Prisma } from '@prisma/client'
import type { z } from 'zod'
import { prisma } from '../../config/db.js'
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js'
import { LessonType, Role } from '../../shared/enums.js'
import { isSuperAdmin } from '../../shared/roles.js'
import type {
  lessonInputSchema,
  moduleInputSchema,
  subjectInputSchema,
} from '../../shared/schemas/course.js'

type SubjectInput = z.infer<typeof subjectInputSchema>
type ModuleInput = z.infer<typeof moduleInputSchema>
type LessonInput = z.infer<typeof lessonInputSchema>

type Tx = Prisma.TransactionClient

type LessonRow = { id: string }
type ModuleRow = { id: string; title: string; lessons: LessonRow[] }
type SubjectRow = { id: string; title: string; modules: ModuleRow[] }

/** Large live batches can exceed Prisma's default 5s interactive transaction limit. */
const CURRICULUM_TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 120_000,
} as const

export const CONFIRM_DELETE_TOKEN = 'DELETE'

function parseLectureDate(value: string | null | undefined): Date | null {
  if (!value) return null
  return new Date(`${value}T00:00:00.000Z`)
}

function lessonData(lesson: LessonInput, moduleId: string, order: number) {
  return {
    moduleId,
    title: lesson.title,
    type: lesson.type ?? LessonType.RECORDED,
    videoUrl: lesson.videoUrl ?? null,
    content: lesson.content ?? null,
    durationS: lesson.durationS ?? null,
    order: lesson.order ?? order,
    isPreview: lesson.isPreview ?? false,
    lectureDate: parseLectureDate(lesson.lectureDate),
  }
}

function assertConfirm(confirm: string | undefined): void {
  if (confirm !== CONFIRM_DELETE_TOKEN) {
    throw validationError(
      `Deletion requires confirm: "${CONFIRM_DELETE_TOKEN}". This permanently removes classes and resources.`,
    )
  }
}

function assertSuperAdmin(role: Role): void {
  if (!isSuperAdmin(role)) {
    throw forbidden('Only Super Admin can permanently delete courses, batches, or curriculum')
  }
}

/** Count resources under a subject / chapter / lesson scope. */
export async function countAttachedResources(
  scope: { subjectId?: string; moduleId?: string; lessonId?: string; batchId?: string; courseId?: string },
): Promise<number> {
  const or: Prisma.ResourceWhereInput[] = []
  if (scope.lessonId) or.push({ lessonId: scope.lessonId })
  if (scope.moduleId) {
    or.push({ moduleId: scope.moduleId }, { lesson: { moduleId: scope.moduleId } })
  }
  if (scope.subjectId) {
    or.push(
      { subjectId: scope.subjectId },
      { module: { subjectId: scope.subjectId } },
      { lesson: { module: { subjectId: scope.subjectId } } },
    )
  }
  if (scope.batchId) or.push({ batchId: scope.batchId })
  if (scope.courseId) or.push({ courseId: scope.courseId })
  if (!or.length) return 0
  return prisma.resource.count({ where: { OR: or } })
}

async function syncLessons(
  tx: Tx,
  moduleId: string,
  lessonsInput: LessonInput[],
  existingLessons: LessonRow[],
): Promise<void> {
  const existingIds = new Set(existingLessons.map((l) => l.id))
  const kept = new Set<string>()

  for (const [li, lessonInput] of lessonsInput.entries()) {
    if (lessonInput.id && existingIds.has(lessonInput.id)) {
      await tx.lesson.update({
        where: { id: lessonInput.id },
        data: lessonData(lessonInput, moduleId, li),
      })
      kept.add(lessonInput.id)
    } else {
      const created = await tx.lesson.create({
        data: lessonData(lessonInput, moduleId, li),
      })
      kept.add(created.id)
    }
  }

  const omitted = existingLessons.filter((l) => !kept.has(l.id))
  if (omitted.length > 0) {
    throw conflict(
      `Curriculum save cannot delete lessons. ${omitted.length} existing lesson(s) were omitted from the payload. Use Super Admin Delete with confirmation to remove them.`,
    )
  }
}

async function syncModulesForSubject(
  tx: Tx,
  subjectId: string,
  modulesInput: ModuleInput[],
  existingModules: ModuleRow[],
): Promise<void> {
  const existingMap = new Map(existingModules.map((m) => [m.id, m]))
  const kept = new Set<string>()

  for (const [mi, modInput] of modulesInput.entries()) {
    let moduleId: string
    let existingLessons: LessonRow[] = []

    if (modInput.id && existingMap.has(modInput.id)) {
      await tx.module.update({
        where: { id: modInput.id },
        data: { title: modInput.title, order: modInput.order ?? mi },
      })
      moduleId = modInput.id
      existingLessons = existingMap.get(modInput.id)!.lessons
    } else {
      const created = await tx.module.create({
        data: { subjectId, title: modInput.title, order: modInput.order ?? mi },
      })
      moduleId = created.id
    }
    kept.add(moduleId)
    await syncLessons(tx, moduleId, modInput.lessons ?? [], existingLessons)
  }

  const omitted = existingModules.filter((m) => !kept.has(m.id))
  if (omitted.length > 0) {
    throw conflict(
      `Curriculum save cannot delete chapters. ${omitted.length} existing chapter(s) were omitted (${omitted.map((m) => m.title).join(', ')}). Use Super Admin Delete with confirmation to remove them.`,
    )
  }
}

async function syncSubjectsForBatch(tx: Tx, batchId: string, subjectsInput: SubjectInput[]): Promise<void> {
  const existing: SubjectRow[] = await tx.subject.findMany({
    where: { batchId },
    include: { modules: { include: { lessons: { select: { id: true } } } } },
  })
  const existingIds = new Set(existing.map((s) => s.id))
  const kept = new Set<string>()

  for (const [si, subjectInput] of subjectsInput.entries()) {
    let subjectId: string
    let existingModules: ModuleRow[] = []

    if (subjectInput.id && existingIds.has(subjectInput.id)) {
      await tx.subject.update({
        where: { id: subjectInput.id },
        data: { title: subjectInput.title, order: subjectInput.order ?? si },
      })
      subjectId = subjectInput.id
      existingModules = existing.find((s) => s.id === subjectInput.id)!.modules
    } else {
      const created = await tx.subject.create({
        data: { batchId, title: subjectInput.title, order: subjectInput.order ?? si },
      })
      subjectId = created.id
    }
    kept.add(subjectId)
    await syncModulesForSubject(tx, subjectId, subjectInput.modules ?? [], existingModules)
  }

  const omitted = existing.filter((s) => !kept.has(s.id))
  if (omitted.length > 0) {
    throw conflict(
      `Curriculum save cannot delete subjects. ${omitted.length} existing subject(s) were omitted (${omitted.map((s) => s.title).join(', ')}). Use Super Admin Delete with confirmation to remove them.`,
    )
  }
}

async function syncModulesForCourse(
  tx: Tx,
  courseId: string,
  modulesInput: ModuleInput[],
): Promise<void> {
  const existing = await tx.module.findMany({
    where: { courseId },
    include: { lessons: { select: { id: true } } },
  })
  const existingMap = new Map(existing.map((m) => [m.id, m]))
  const kept = new Set<string>()

  for (const [mi, modInput] of modulesInput.entries()) {
    let moduleId: string
    let existingLessons: LessonRow[] = []

    if (modInput.id && existingMap.has(modInput.id)) {
      await tx.module.update({
        where: { id: modInput.id },
        data: { title: modInput.title, order: modInput.order ?? mi },
      })
      moduleId = modInput.id
      existingLessons = existingMap.get(modInput.id)!.lessons
    } else {
      const created = await tx.module.create({
        data: { courseId, title: modInput.title, order: modInput.order ?? mi },
      })
      moduleId = created.id
    }
    kept.add(moduleId)
    await syncLessons(tx, moduleId, modInput.lessons ?? [], existingLessons)
  }

  const omitted = existing.filter((m) => !kept.has(m.id))
  if (omitted.length > 0) {
    throw conflict(
      `Curriculum save cannot delete chapters. ${omitted.length} existing chapter(s) were omitted (${omitted.map((m) => m.title).join(', ')}). Use Super Admin Delete with confirmation to remove them.`,
    )
  }
}

export function stripCurriculumIds(subjects: SubjectInput[]): SubjectInput[] {
  return subjects.map((subject) => ({
    title: subject.title,
    order: subject.order,
    modules: subject.modules?.map((mod) => ({
      title: mod.title,
      order: mod.order,
      lessons: mod.lessons?.map((lesson) => ({
        title: lesson.title,
        type: lesson.type,
        videoUrl: lesson.videoUrl,
        content: lesson.content,
        durationS: lesson.durationS,
        lectureDate: lesson.lectureDate,
        order: lesson.order,
        isPreview: lesson.isPreview,
      })),
    })),
  }))
}

export async function syncBatchCurriculum(batchId: string, subjects: SubjectInput[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await syncSubjectsForBatch(tx, batchId, subjects)
  }, CURRICULUM_TX_OPTIONS)
}

export async function syncRecordedCurriculum(
  courseId: string,
  modules: ModuleInput[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await syncModulesForCourse(tx, courseId, modules)
  }, CURRICULUM_TX_OPTIONS)
}

export async function validateBatchCurriculumIds(
  batchId: string,
  subjects: SubjectInput[],
): Promise<void> {
  const existing = await prisma.subject.findMany({
    where: { batchId },
    select: {
      id: true,
      modules: { select: { id: true, lessons: { select: { id: true } } } },
    },
  })
  const subjectIds = new Set(existing.map((s) => s.id))
  const moduleIds = new Set(existing.flatMap((s) => s.modules.map((m) => m.id)))
  const lessonIds = new Set(
    existing.flatMap((s) => s.modules.flatMap((m) => m.lessons.map((l) => l.id))),
  )

  for (const subject of subjects) {
    if (subject.id && !subjectIds.has(subject.id)) {
      throw validationError('Curriculum subject id does not belong to this batch')
    }
    for (const mod of subject.modules ?? []) {
      if (mod.id && !moduleIds.has(mod.id)) {
        throw validationError('Curriculum chapter id does not belong to this batch')
      }
      for (const lesson of mod.lessons ?? []) {
        if (lesson.id && !lessonIds.has(lesson.id)) {
          throw validationError('Curriculum lesson id does not belong to this batch')
        }
      }
    }
  }
}

export async function validateRecordedCurriculumIds(
  courseId: string,
  modules: ModuleInput[],
): Promise<void> {
  const existing = await prisma.module.findMany({
    where: { courseId },
    select: { id: true, lessons: { select: { id: true } } },
  })
  const moduleIds = new Set(existing.map((m) => m.id))
  const lessonIds = new Set(existing.flatMap((m) => m.lessons.map((l) => l.id)))

  for (const mod of modules) {
    if (mod.id && !moduleIds.has(mod.id)) {
      throw validationError('Curriculum chapter id does not belong to this course')
    }
    for (const lesson of mod.lessons ?? []) {
      if (lesson.id && !lessonIds.has(lesson.id)) {
        throw validationError('Curriculum lesson id does not belong to this course')
      }
    }
  }
}

async function deleteResourcesForLesson(tx: Tx, lessonId: string): Promise<number> {
  const result = await tx.resource.deleteMany({ where: { lessonId } })
  return result.count
}

async function assertBatchExists(batchId: string) {
  const batch = await prisma.batch.findFirst({ where: { id: batchId, deletedAt: null } })
  if (!batch) throw notFound('Batch not found')
  return batch
}

async function assertSubjectInBatch(batchId: string, subjectId: string) {
  const subject = await prisma.subject.findFirst({ where: { id: subjectId, batchId } })
  if (!subject) throw validationError('Subject does not belong to this batch')
  return subject
}

async function assertModuleInBatch(batchId: string, moduleId: string) {
  const mod = await prisma.module.findFirst({
    where: { id: moduleId, subject: { batchId } },
  })
  if (!mod) throw validationError('Chapter does not belong to this batch')
  return mod
}

async function assertCourseRecorded(courseId: string) {
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
  })
  if (!course) throw notFound('Course not found')
  if (course.deliveryMode !== 'RECORDED') {
    throw validationError('Only RECORDED courses have top-level chapters')
  }
  return course
}

async function assertModuleInCourse(courseId: string, moduleId: string) {
  const mod = await prisma.module.findFirst({ where: { id: moduleId, courseId } })
  if (!mod) throw validationError('Chapter does not belong to this course')
  return mod
}

function validateLessonIdsInModule(existingLessons: LessonRow[], lessonsInput: LessonInput[]): void {
  const lessonIds = new Set(existingLessons.map((l) => l.id))
  for (const lesson of lessonsInput) {
    if (lesson.id && !lessonIds.has(lesson.id)) {
      throw validationError('Lesson id does not belong to this chapter')
    }
  }
}

/** Save one chapter's lessons only (create/update — no omission deletes). */
export async function upsertModuleLessons(
  moduleId: string,
  lessonsInput: LessonInput[],
  meta?: { title?: string; order?: number },
): Promise<void> {
  const existing = await prisma.lesson.findMany({
    where: { moduleId },
    select: { id: true },
  })
  validateLessonIdsInModule(existing, lessonsInput)

  await prisma.$transaction(async (tx) => {
    if (meta?.title !== undefined || meta?.order !== undefined) {
      await tx.module.update({
        where: { id: moduleId },
        data: {
          ...(meta.title !== undefined ? { title: meta.title } : {}),
          ...(meta.order !== undefined ? { order: meta.order } : {}),
        },
      })
    }
    await syncLessons(tx, moduleId, lessonsInput, existing)
  })
}

export async function createBatchSubject(
  batchId: string,
  input: { title: string; order?: number },
): Promise<{ id: string; title: string; order: number }> {
  await assertBatchExists(batchId)
  const order =
    input.order ??
    (await prisma.subject.count({ where: { batchId } }))
  const subject = await prisma.subject.create({
    data: { batchId, title: input.title, order },
  })
  return { id: subject.id, title: subject.title, order: subject.order }
}

export async function updateBatchSubject(
  batchId: string,
  subjectId: string,
  input: { title?: string; order?: number },
): Promise<{ id: string; title: string; order: number }> {
  await assertSubjectInBatch(batchId, subjectId)
  const subject = await prisma.subject.update({
    where: { id: subjectId },
    data: input,
  })
  return { id: subject.id, title: subject.title, order: subject.order }
}

export async function createSubjectModule(
  batchId: string,
  subjectId: string,
  input: { title: string; order?: number },
): Promise<{ id: string; title: string; order: number }> {
  await assertSubjectInBatch(batchId, subjectId)
  const order =
    input.order ??
    (await prisma.module.count({ where: { subjectId } }))
  const mod = await prisma.module.create({
    data: { subjectId, title: input.title, order },
  })
  return { id: mod.id, title: mod.title, order: mod.order }
}

export async function updateBatchModule(
  batchId: string,
  moduleId: string,
  input: { title?: string; order?: number; lessons?: LessonInput[] },
): Promise<void> {
  await assertModuleInBatch(batchId, moduleId)
  if (input.lessons !== undefined) {
    await upsertModuleLessons(moduleId, input.lessons, {
      title: input.title,
      order: input.order,
    })
    return
  }
  if (input.title !== undefined || input.order !== undefined) {
    await prisma.module.update({
      where: { id: moduleId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
      },
    })
  }
}

export async function createCourseModule(
  courseId: string,
  input: { title: string; order?: number },
): Promise<{ id: string; title: string; order: number }> {
  await assertCourseRecorded(courseId)
  const order =
    input.order ??
    (await prisma.module.count({ where: { courseId } }))
  const mod = await prisma.module.create({
    data: { courseId, title: input.title, order },
  })
  return { id: mod.id, title: mod.title, order: mod.order }
}

export async function updateCourseModule(
  courseId: string,
  moduleId: string,
  input: { title?: string; order?: number; lessons?: LessonInput[] },
): Promise<void> {
  await assertModuleInCourse(courseId, moduleId)
  if (input.lessons !== undefined) {
    await upsertModuleLessons(moduleId, input.lessons, {
      title: input.title,
      order: input.order,
    })
    return
  }
  if (input.title !== undefined || input.order !== undefined) {
    await prisma.module.update({
      where: { id: moduleId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
      },
    })
  }
}

async function deleteResourcesForModule(tx: Tx, moduleId: string): Promise<number> {
  const result = await tx.resource.deleteMany({
    where: {
      OR: [{ moduleId }, { lesson: { moduleId } }],
    },
  })
  return result.count
}

async function deleteResourcesForSubject(tx: Tx, subjectId: string): Promise<number> {
  const result = await tx.resource.deleteMany({
    where: {
      OR: [
        { subjectId },
        { module: { subjectId } },
        { lesson: { module: { subjectId } } },
      ],
    },
  })
  return result.count
}

export type CascadeDeleteResult = {
  deletedResources: number
  deletedSubjects?: number
  deletedModules?: number
  deletedLessons?: number
}

/** Permanently delete a chapter (module) and all lessons + resources under it. */
export async function cascadeDeleteModule(
  role: Role,
  moduleId: string,
  confirm: string | undefined,
): Promise<CascadeDeleteResult> {
  assertSuperAdmin(role)
  assertConfirm(confirm)

  const mod = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { id: true, title: true, _count: { select: { lessons: true } } },
  })
  if (!mod) throw notFound('Chapter not found')

  return prisma.$transaction(async (tx) => {
    const deletedResources = await deleteResourcesForModule(tx, moduleId)
    const lessons = await tx.lesson.deleteMany({ where: { moduleId } })
    await tx.module.delete({ where: { id: moduleId } })
    return {
      deletedResources,
      deletedModules: 1,
      deletedLessons: lessons.count,
    }
  }, CURRICULUM_TX_OPTIONS)
}

/** Permanently delete a subject and all chapters / lessons / resources under it. */
export async function cascadeDeleteSubject(
  role: Role,
  subjectId: string,
  confirm: string | undefined,
): Promise<CascadeDeleteResult> {
  assertSuperAdmin(role)
  assertConfirm(confirm)

  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { id: true, title: true },
  })
  if (!subject) throw notFound('Subject not found')

  return prisma.$transaction(async (tx) => {
    const modules = await tx.module.findMany({
      where: { subjectId },
      select: { id: true },
    })
    const deletedResources = await deleteResourcesForSubject(tx, subjectId)
    let deletedLessons = 0
    for (const m of modules) {
      const r = await tx.lesson.deleteMany({ where: { moduleId: m.id } })
      deletedLessons += r.count
    }
    const deletedModules = await tx.module.deleteMany({ where: { subjectId } })
    await tx.subject.delete({ where: { id: subjectId } })
    return {
      deletedResources,
      deletedSubjects: 1,
      deletedModules: deletedModules.count,
      deletedLessons,
    }
  }, CURRICULUM_TX_OPTIONS)
}

/** Permanently delete a lesson and its resources. */
export async function cascadeDeleteLesson(
  role: Role,
  lessonId: string,
  confirm: string | undefined,
): Promise<CascadeDeleteResult> {
  assertSuperAdmin(role)
  assertConfirm(confirm)

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true },
  })
  if (!lesson) throw notFound('Lesson not found')

  return prisma.$transaction(async (tx) => {
    const deletedResources = await deleteResourcesForLesson(tx, lessonId)
    await tx.lesson.delete({ where: { id: lessonId } })
    return {
      deletedResources,
      deletedLessons: 1,
    }
  })
}

/** Preview counts before cascade delete (for confirmation modals). */
export async function getCascadeDeletePreview(scope: {
  courseId?: string
  batchId?: string
  subjectId?: string
  moduleId?: string
  lessonId?: string
}): Promise<{
  resources: number
  subjects: number
  modules: number
  lessons: number
  enrollments: number
}> {
  if (scope.lessonId) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: scope.lessonId },
      select: { id: true },
    })
    if (!lesson) throw notFound('Lesson not found')
    const resources = await countAttachedResources({ lessonId: scope.lessonId })
    return {
      resources,
      subjects: 0,
      modules: 0,
      lessons: 1,
      enrollments: 0,
    }
  }

  if (scope.moduleId) {
    const mod = await prisma.module.findUnique({
      where: { id: scope.moduleId },
      select: { _count: { select: { lessons: true, resources: true } } },
    })
    if (!mod) throw notFound('Chapter not found')
    const resources = await countAttachedResources({ moduleId: scope.moduleId })
    return {
      resources,
      subjects: 0,
      modules: 1,
      lessons: mod._count.lessons,
      enrollments: 0,
    }
  }

  if (scope.subjectId) {
    const subject = await prisma.subject.findUnique({
      where: { id: scope.subjectId },
      include: {
        modules: { select: { id: true, _count: { select: { lessons: true } } } },
      },
    })
    if (!subject) throw notFound('Subject not found')
    const resources = await countAttachedResources({ subjectId: scope.subjectId })
    const lessons = subject.modules.reduce((n, m) => n + m._count.lessons, 0)
    return {
      resources,
      subjects: 1,
      modules: subject.modules.length,
      lessons,
      enrollments: 0,
    }
  }

  if (scope.batchId) {
    const batch = await prisma.batch.findFirst({
      where: { id: scope.batchId },
      include: {
        subjects: {
          include: { modules: { select: { id: true, _count: { select: { lessons: true } } } } },
        },
        _count: { select: { enrollments: true, resources: true } },
      },
    })
    if (!batch) throw notFound('Batch not found')
    const modules = batch.subjects.flatMap((s) => s.modules)
    const lessons = modules.reduce((n, m) => n + m._count.lessons, 0)
    return {
      resources: batch._count.resources,
      subjects: batch.subjects.length,
      modules: modules.length,
      lessons,
      enrollments: batch._count.enrollments,
    }
  }

  if (scope.courseId) {
    const course = await prisma.course.findFirst({
      where: { id: scope.courseId },
      include: {
        batches: {
          include: {
            subjects: {
              include: {
                modules: { select: { id: true, _count: { select: { lessons: true } } } },
              },
            },
            _count: { select: { enrollments: true } },
          },
        },
        modules: { select: { id: true, _count: { select: { lessons: true } } } },
        _count: { select: { resources: true, enrollments: true } },
      },
    })
    if (!course) throw notFound('Course not found')
    const batchSubjects = course.batches.flatMap((b) => b.subjects)
    const batchModules = batchSubjects.flatMap((s) => s.modules)
    const batchLessons = batchModules.reduce((n, m) => n + m._count.lessons, 0)
    const recordedLessons = course.modules.reduce((n, m) => n + m._count.lessons, 0)
    const enrollments =
      course._count.enrollments +
      course.batches.reduce((n, b) => n + b._count.enrollments, 0)
    return {
      resources: course._count.resources,
      subjects: batchSubjects.length,
      modules: batchModules.length + course.modules.length,
      lessons: batchLessons + recordedLessons,
      enrollments,
    }
  }

  throw validationError('Provide courseId, batchId, subjectId, moduleId, or lessonId')
}
