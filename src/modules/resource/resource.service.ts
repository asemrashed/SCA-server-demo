import { Prisma } from '@prisma/client'
import type { z } from 'zod'
import { prisma } from '../../config/db.js'
import { forbidden, notFound, validationError } from '../../lib/errors.js'
import { ResourceCategory, DeliveryMode, Role } from '../../shared/enums.js'
import { isAdminStaff } from '../../shared/roles.js'
import {
  createResourceSchema,
  resourceListQuerySchema,
  updateResourceSchema,
} from '../../shared/schemas/resource.js'
import type { ApiListResponse } from '../../shared/types/index.js'
import {
  assertStudentCourseContentAccess,
  isStudentCourseContentAccess,
} from '../enrollment/enrollment.access.js'
import { toResourceDto, type ResourceDto } from './resource.mapper.js'
import {
  BATCH_SCOPED_CATEGORIES,
  isChapterRequiredCategory,
  LIVE_SUBJECT_SCOPED_CATEGORIES,
} from '../../shared/resource-placement.js'

type CreateResourceInput = z.infer<typeof createResourceSchema>
type UpdateResourceInput = z.infer<typeof updateResourceSchema>
type ResourceListQuery = z.infer<typeof resourceListQuerySchema>

function assertCategoryPlacement(
  course: { deliveryMode: DeliveryMode },
  input: {
    category: ResourceCategory
    batchId?: string | null
    subjectId?: string | null
    moduleId?: string | null
    deadlineAt?: Date | null
    startsAt?: Date | null
  },
): void {
  if (course.deliveryMode === DeliveryMode.LIVE) {
    if (BATCH_SCOPED_CATEGORIES.has(input.category) && !input.batchId) {
      throw validationError('Batch is required for this resource type')
    }
    if (LIVE_SUBJECT_SCOPED_CATEGORIES.has(input.category) && !input.subjectId && !input.moduleId) {
      throw validationError('Subject is required for this resource type')
    }
  }

  if (isChapterRequiredCategory(input.category) && !input.moduleId) {
    throw validationError('Chapter is required for this resource type')
  }

  if (
    (input.category === ResourceCategory.EXAM || input.category === ResourceCategory.ASSIGNMENT) &&
    !input.deadlineAt
  ) {
    throw validationError('Deadline is required for exams and assignments')
  }

  if (
    (input.category === ResourceCategory.EXAM || input.category === ResourceCategory.ASSIGNMENT) &&
    !input.startsAt
  ) {
    throw validationError('Start time is required for exams and assignments')
  }

  if (
    input.startsAt &&
    input.deadlineAt &&
    input.startsAt.getTime() > input.deadlineAt.getTime()
  ) {
    throw validationError('Start time must be before the deadline')
  }
}

const PDF_ONLY_CATEGORIES = new Set<ResourceCategory>([
  ResourceCategory.LECTURE_SHEET,
  ResourceCategory.SOLUTION_PDF,
  ResourceCategory.NOTICE,
  ResourceCategory.RESULT_SHEET,
  ResourceCategory.MATH_SUGGESTION,
  ResourceCategory.THEORY_SUGGESTION,
  ResourceCategory.EXAM,
  ResourceCategory.ASSIGNMENT,
  ResourceCategory.QUESTION_BANK,
])

function parseSort(sort?: string): Prisma.ResourceOrderByWithRelationInput {
  if (!sort) return { createdAt: 'desc' }
  const [field, dir] = sort.split(':')
  const allowed = new Set(['createdAt', 'title'])
  if (!allowed.has(field)) return { createdAt: 'desc' }
  return { [field]: dir === 'asc' ? 'asc' : 'desc' }
}

function normalizeFileType(
  category: ResourceCategory,
  fileType: string | null | undefined,
): string | null {
  if (PDF_ONLY_CATEGORIES.has(category)) return 'pdf'
  return fileType ?? null
}

async function assertCanViewCourse(
  userId: string,
  role: Role,
  courseId: string,
): Promise<void> {
  if (isAdminStaff(role)) return
  if (role === Role.STUDENT) {
    const allowed = await isStudentCourseContentAccess(userId, courseId)
    if (!allowed) {
      throw forbidden('Not enrolled in this course')
    }
    return
  }
  throw forbidden()
}

function assertAdminStaff(role: Role): void {
  if (!isAdminStaff(role)) {
    throw forbidden('Admin access required')
  }
}

/** Resolve subjectId from module/lesson when not provided explicitly. */
async function resolveSubjectId(input: {
  subjectId?: string | null
  moduleId?: string | null
  lessonId?: string | null
}): Promise<string | null> {
  if (input.subjectId) return input.subjectId

  if (input.lessonId) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: input.lessonId },
      select: { module: { select: { subjectId: true } } },
    })
    if (lesson?.module.subjectId) return lesson.module.subjectId
  }

  if (input.moduleId) {
    const module = await prisma.module.findUnique({
      where: { id: input.moduleId },
      select: { subjectId: true },
    })
    if (module?.subjectId) return module.subjectId
  }

  return null
}

async function validatePlacement(input: {
  courseId: string
  batchId?: string | null
  subjectId?: string | null
  moduleId?: string | null
  lessonId?: string | null
}): Promise<void> {
  const course = await prisma.course.findFirst({
    where: { id: input.courseId, deletedAt: null },
  })
  if (!course) {
    throw notFound('Course not found')
  }

  if (input.batchId) {
    const batch = await prisma.batch.findFirst({
      where: { id: input.batchId, deletedAt: null },
    })
    if (!batch || batch.courseId !== input.courseId) {
      throw validationError('Batch does not belong to this course')
    }
  }

  if (input.subjectId) {
    const subject = await prisma.subject.findUnique({
      where: { id: input.subjectId },
      include: { batch: { select: { courseId: true, id: true } } },
    })
    if (!subject || subject.batch.courseId !== input.courseId) {
      throw validationError('Subject does not belong to this course')
    }
    if (input.batchId && subject.batchId !== input.batchId) {
      throw validationError('Subject does not belong to this batch')
    }
  }

  if (input.lessonId) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: input.lessonId },
      include: { module: { include: { subject: { include: { batch: true } } } } },
    })
    if (!lesson) {
      throw notFound('Lesson not found')
    }

    const module = lesson.module
    const lessonCourseId =
      module.courseId ?? module.subject?.batch.courseId ?? null
    if (lessonCourseId !== input.courseId) {
      throw validationError('Lesson does not belong to this course')
    }
  }

  if (input.moduleId) {
    const module = await prisma.module.findUnique({
      where: { id: input.moduleId },
      include: { subject: { include: { batch: true } } },
    })
    if (!module) {
      throw notFound('Module not found')
    }

    const moduleCourseId = module.courseId ?? module.subject?.batch.courseId ?? null
    if (moduleCourseId !== input.courseId) {
      throw validationError('Module does not belong to this course')
    }
  }
}

async function getResourceOrThrow(resourceId: string) {
  const row = await prisma.resource.findUnique({ where: { id: resourceId } })
  if (!row) {
    throw notFound('Resource not found')
  }
  return row
}

export async function listResources(
  userId: string,
  role: Role,
  query: ResourceListQuery,
): Promise<ApiListResponse<ResourceDto>> {
  await assertCanViewCourse(userId, role, query.courseId)

  const subjectFilter: Prisma.ResourceWhereInput | undefined = query.subjectId
    ? {
        OR: [
          { subjectId: query.subjectId },
          { module: { subjectId: query.subjectId } },
          { lesson: { module: { subjectId: query.subjectId } } },
        ],
      }
    : undefined

  const where: Prisma.ResourceWhereInput = {
    courseId: query.courseId,
    ...(query.batchId ? { batchId: query.batchId } : {}),
    ...(subjectFilter ?? {}),
    ...(query.moduleId ? { moduleId: query.moduleId } : {}),
    ...(query.lessonId ? { lessonId: query.lessonId } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.search
      ? { title: { contains: query.search, mode: 'insensitive' } }
      : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          createdAt: {
            ...(query.dateFrom ? { gte: query.dateFrom } : {}),
            ...(query.dateTo ? { lte: query.dateTo } : {}),
          },
        }
      : {}),
  }

  const [total, rows] = await Promise.all([
    prisma.resource.count({ where }),
    prisma.resource.findMany({
      where,
      orderBy: parseSort(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ])

  return {
    data: rows.map((row) => toResourceDto(row, role)),
    meta: { page: query.page, pageSize: query.pageSize, total },
  }
}

export async function createResource(
  userId: string,
  role: Role,
  input: CreateResourceInput,
): Promise<ResourceDto> {
  const course = await prisma.course.findFirst({
    where: { id: input.courseId, deletedAt: null },
  })
  if (!course) {
    throw notFound('Course not found')
  }

  const category = input.category ?? ResourceCategory.GENERAL
  const subjectId = await resolveSubjectId({
    subjectId: input.subjectId,
    moduleId: input.moduleId,
    lessonId: input.lessonId,
  })

  assertCategoryPlacement(
    { deliveryMode: course.deliveryMode as DeliveryMode },
    {
      category,
      batchId: input.batchId,
      subjectId,
      moduleId: input.moduleId,
      deadlineAt: input.deadlineAt,
      startsAt: input.startsAt,
    },
  )

  const placement = { ...input, subjectId }
  await validatePlacement(placement)
  assertAdminStaff(role)

  const linkedQuestionIds = input.linkedQuestionIds ?? []
  let fileUrl = input.fileUrl?.trim() ?? ''
  if (!fileUrl && linkedQuestionIds.length > 0) {
    const firstQuestion = await prisma.resource.findFirst({
      where: { id: { in: linkedQuestionIds }, category: ResourceCategory.QUESTION_BANK },
    })
    if (!firstQuestion) {
      throw validationError('Linked question IDs are invalid')
    }
    fileUrl = firstQuestion.fileUrl
  }

  const row = await prisma.$transaction(async (tx) => {
    let finalLinkedQuestionIds = [...linkedQuestionIds]

    if (
      category === ResourceCategory.EXAM &&
      fileUrl &&
      finalLinkedQuestionIds.length === 0
    ) {
      const questionBankRow = await tx.resource.create({
        data: {
          title: input.title,
          fileUrl,
          fileType: normalizeFileType(ResourceCategory.QUESTION_BANK, input.fileType),
          category: ResourceCategory.QUESTION_BANK,
          courseId: input.courseId,
          batchId: input.batchId ?? null,
          subjectId,
          moduleId: input.moduleId ?? null,
          lessonId: input.lessonId ?? null,
          marks: input.marks ?? 1,
        },
      })
      finalLinkedQuestionIds = [questionBankRow.id]
    }

    return tx.resource.create({
      data: {
        title: input.title,
        fileUrl,
        fileType: normalizeFileType(category, input.fileType),
        category,
        courseId: input.courseId,
        batchId: input.batchId ?? null,
        subjectId,
        moduleId: input.moduleId ?? null,
        lessonId: input.lessonId ?? null,
        deadlineAt: input.deadlineAt ?? null,
        startsAt: input.startsAt ?? null,
        marks: input.marks ?? null,
        linkedQuestionIds: finalLinkedQuestionIds.length
          ? finalLinkedQuestionIds
          : undefined,
      },
    })
  })

  return toResourceDto(row, role)
}

export async function updateResource(
  userId: string,
  role: Role,
  resourceId: string,
  input: UpdateResourceInput,
): Promise<ResourceDto> {
  const existing = await getResourceOrThrow(resourceId)
  assertAdminStaff(role)

  const course = await prisma.course.findFirst({
    where: { id: existing.courseId, deletedAt: null },
  })
  if (!course) {
    throw notFound('Course not found')
  }

  const category = input.category ?? (existing.category as ResourceCategory)
  const mergedPlacement = {
    batchId: input.batchId !== undefined ? input.batchId : existing.batchId,
    subjectId: input.subjectId !== undefined ? input.subjectId : existing.subjectId,
    moduleId: input.moduleId !== undefined ? input.moduleId : existing.moduleId,
    lessonId: input.lessonId !== undefined ? input.lessonId : existing.lessonId,
  }
  const subjectId = await resolveSubjectId(mergedPlacement)
  const merged = {
    category,
    ...mergedPlacement,
    subjectId,
    deadlineAt: input.deadlineAt !== undefined ? input.deadlineAt : existing.deadlineAt,
    startsAt: input.startsAt !== undefined ? input.startsAt : existing.startsAt,
    fileType: input.fileType !== undefined ? input.fileType : existing.fileType,
  }

  assertCategoryPlacement(
    { deliveryMode: course.deliveryMode as DeliveryMode },
    merged,
  )

  await validatePlacement({
    courseId: existing.courseId,
    batchId: merged.batchId,
    subjectId: merged.subjectId,
    moduleId: merged.moduleId,
    lessonId: merged.lessonId,
  })

  const updateData: Prisma.ResourceUpdateInput = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.fileUrl !== undefined ? { fileUrl: input.fileUrl } : {}),
    ...(input.fileType !== undefined || PDF_ONLY_CATEGORIES.has(category)
      ? { fileType: normalizeFileType(category, input.fileType ?? existing.fileType) }
      : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.batchId !== undefined ? { batchId: input.batchId } : {}),
    ...(input.subjectId !== undefined || subjectId !== existing.subjectId
      ? { subjectId }
      : {}),
    ...(input.moduleId !== undefined ? { moduleId: input.moduleId } : {}),
    ...(input.lessonId !== undefined ? { lessonId: input.lessonId } : {}),
    ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
    ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
    ...(input.marks !== undefined ? { marks: input.marks } : {}),
    ...(input.linkedQuestionIds !== undefined
      ? {
          linkedQuestionIds: input.linkedQuestionIds?.length
            ? input.linkedQuestionIds
            : Prisma.DbNull,
        }
      : {}),
  }

  const row = await prisma.resource.update({
    where: { id: resourceId },
    data: updateData,
  })

  return toResourceDto(row, role)
}

export async function deleteResource(
  userId: string,
  role: Role,
  resourceId: string,
): Promise<void> {
  const existing = await getResourceOrThrow(resourceId)
  assertAdminStaff(role)
  await prisma.resource.delete({ where: { id: resourceId } })
}

const GOOGLE_LINK_HELP =
  "This link isn't a public PDF. Open the file's sharing settings and set it to " +
  "'Anyone with the link', or upload the PDF directly."

/**
 * Convert Google Drive/Docs share URLs into direct-download endpoints that return
 * raw PDF bytes. Non-Google URLs are returned unchanged. Only http(s) is allowed
 * (guards against file://, internal schemes when proxy-fetching admin-supplied URLs).
 */
function normalizeStreamableUrl(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw validationError('Resource URL is invalid')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw validationError('Resource URL must be an http(s) link')
  }

  const host = parsed.hostname

  if (host === 'drive.google.com') {
    // https://drive.google.com/file/d/FILE_ID/view?resourcekey=...
    const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/)
    const fileId = fileMatch?.[1] ?? parsed.searchParams.get('id')
    if (fileId) {
      // Files shared with a resourcekey require it on the download endpoint too,
      // otherwise Google returns a sign-in page instead of the file bytes.
      const resourceKey = parsed.searchParams.get('resourcekey')
      const params = new URLSearchParams({ export: 'download', id: fileId })
      if (resourceKey) params.set('resourcekey', resourceKey)
      return `https://drive.google.com/uc?${params.toString()}`
    }
  }

  if (host === 'docs.google.com') {
    // https://docs.google.com/document|spreadsheets|presentation/d/DOC_ID/edit
    const docMatch = parsed.pathname.match(
      /\/(document|spreadsheets|presentation)\/d\/([^/]+)/,
    )
    if (docMatch) {
      const [, kind, docId] = docMatch
      return `https://docs.google.com/${kind}/d/${docId}/export?format=pdf`
    }
  }

  return rawUrl
}

function isGoogleHost(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname
    return host === 'drive.google.com' || host === 'docs.google.com'
  } catch {
    return false
  }
}

/** A real PDF always begins with the magic bytes `%PDF`. */
function isPdfBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46 // F
  )
}

export async function streamResource(
  userId: string,
  role: Role,
  resourceId: string,
): Promise<{ buffer: Buffer; contentType: string; title: string }> {
  const row = await getResourceOrThrow(resourceId)

  await assertCanViewCourse(userId, role, row.courseId)

  const fetchUrl = normalizeStreamableUrl(row.fileUrl)

  const upstream = await fetch(fetchUrl, { redirect: 'follow' }).catch(() => null)
  if (!upstream || !upstream.ok) {
    throw notFound('File could not be loaded from storage')
  }

  const buffer = Buffer.from(await upstream.arrayBuffer())

  // Trust bytes, not headers: Google's content-type is unreliable, and private
  // files / large-file virus-scan interstitials return an HTML page. Anything
  // that isn't a real PDF fails cleanly instead of streaming corrupt content.
  if (!isPdfBuffer(buffer)) {
    throw validationError(
      isGoogleHost(row.fileUrl)
        ? GOOGLE_LINK_HELP
        : 'This link is not a valid PDF file. Upload the PDF directly or paste a direct PDF link.',
    )
  }

  return { buffer, contentType: 'application/pdf', title: row.title }
}

export { assertStudentCourseContentAccess }
