import type {
  Batch,
  Course,
  Enrollment,
  Lesson,
  Module,
  Subject,
  User,
} from '@prisma/client'
import { DeliveryMode, EnrollmentKind, EnrollmentStatus, LessonType } from '../../shared/enums.js'
import { DEFAULT_FIRST_MONTH_FEE_MINOR } from '../monthly-payment/monthly-payment.utils.js'

type LessonRow = Lesson
type ModuleWithLessons = Module & { lessons: LessonRow[] }
type SubjectWithModules = Subject & { modules: ModuleWithLessons[] }

type BatchEnrollmentRow = Enrollment & {
  batch: Batch & {
    course: Pick<Course, 'id' | 'title'>
    subjects: SubjectWithModules[]
  }
  course: null
}

type CourseEnrollmentRow = Enrollment & {
  course: Course & { modules: ModuleWithLessons[] }
  batch: null
}

export type EnrollmentWithRelations = (BatchEnrollmentRow | CourseEnrollmentRow) & {
  student?: Pick<User, 'idNumber'> | null
}

function enrollmentIdNumber(row: {
  idNumber: string | null
  student?: Pick<User, 'idNumber'> | null
}): string | null {
  return row.student?.idNumber ?? row.idNumber
}

export interface EnrollmentListItemDto {
  id: string
  kind: EnrollmentKind
  deliveryMode: DeliveryMode
  batch: {
    id: string
    title: string
    thumbnail: string | null
    course: { id: string; title: string }
  } | null
  course: {
    id: string
    title: string
    thumbnail: string | null
  } | null
  status: EnrollmentStatus
  idNumber: string | null
}

export interface EnrollmentLessonDto {
  id: string
  title: string
  type: LessonType
  hasVideo: boolean
  hasDocument: boolean
  content: string | null
  /** Zoom/Meet link for LIVE lessons. */
  joinUrl: string | null
  durationS: number | null
  lectureDate: string | null
  order: number
}

export interface EnrollmentModuleDto {
  id: string
  title: string
  order: number
  lessons: EnrollmentLessonDto[]
}

export interface EnrollmentSubjectDto {
  id: string
  title: string
  order: number
  modules: EnrollmentModuleDto[]
}

export interface EnrollmentDetailDto {
  id: string
  kind: EnrollmentKind
  deliveryMode: DeliveryMode
  status: EnrollmentStatus
  idNumber: string | null
  enrolledAt: string
  completedAt: string | null
  batch: { id: string; title: string; courseId: string; endDate: string | null } | null
  course: { id: string; title: string } | null
  subjects?: EnrollmentSubjectDto[]
  grantedSubjects?: EnrollmentSubjectDto[]
  modules?: EnrollmentModuleDto[]
  grantedBatchIds?: string[]
  isAccessBlocked: boolean
}

export interface AdminEnrollmentRequestDto {
  id: string
  kind: EnrollmentKind
  status: EnrollmentStatus
  idNumber: string | null
  isBlocked: boolean
  isFullyPaid: boolean
  enrolledAt: string
  student: { id: string; name: string; phone: string }
  batch: { id: string; title: string; course: { id: string; title: string } } | null
  course: { id: string; title: string } | null
  priceMinor: number
  defaultFeeMinor: number | null
  totalSeats: number | null
  totalEnrollments: number
}

function flattenSubjectLessons(subjects: SubjectWithModules[]): LessonRow[] {
  return subjects.flatMap((s) => s.modules.flatMap((m) => m.lessons))
}

function flattenCourseLessons(modules: ModuleWithLessons[]): LessonRow[] {
  return modules.flatMap((m) => m.lessons)
}

function formatLectureDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function toLessonDto(lesson: LessonRow): EnrollmentLessonDto {
  const type = lesson.type as LessonType
  const hasVideoUrl = !!lesson.videoUrl
  const textContent = lesson.content?.trim() ?? ''

  return {
    id: lesson.id,
    title: lesson.title,
    type,
    hasVideo: type === LessonType.RECORDED && hasVideoUrl,
    hasDocument: type === LessonType.DOCUMENT && hasVideoUrl,
    content: type === LessonType.TEXT && textContent ? lesson.content : null,
    joinUrl: type === LessonType.LIVE && hasVideoUrl ? lesson.videoUrl : null,
    durationS: type === LessonType.RECORDED ? lesson.durationS : null,
    lectureDate: lesson.lectureDate ? formatLectureDate(lesson.lectureDate) : null,
    order: lesson.order,
  }
}

export function mapSubjectsToEnrollmentDto(
  subjects: SubjectWithModules[],
): EnrollmentSubjectDto[] {
  return subjects.map((subject) => ({
    id: subject.id,
    title: subject.title,
    order: subject.order,
    modules: subject.modules.map((mod) => ({
      id: mod.id,
      title: mod.title,
      order: mod.order,
      lessons: mod.lessons.map((l) => toLessonDto(l)),
    })),
  }))
}

export function toEnrollmentListItem(row: EnrollmentWithRelations): EnrollmentListItemDto {
  if (row.batchId && row.batch) {
    return {
      id: row.id,
      kind: EnrollmentKind.BATCH,
      deliveryMode: DeliveryMode.LIVE,
      batch: {
        id: row.batch.id,
        title: row.batch.title,
        thumbnail: row.batch.thumbnail,
        course: { id: row.batch.course.id, title: row.batch.course.title },
      },
      course: null,
      status: row.status as EnrollmentStatus,
      idNumber: enrollmentIdNumber(row),
    }
  }

  return {
    id: row.id,
    kind: EnrollmentKind.COURSE,
    deliveryMode: DeliveryMode.RECORDED,
    batch: null,
    course: {
      id: row.course!.id,
      title: row.course!.title,
      thumbnail: row.course!.thumbnail,
    },
    status: row.status as EnrollmentStatus,
    idNumber: enrollmentIdNumber(row),
  }
}

export function toEnrollmentDetail(
  row: EnrollmentWithRelations,
  grantedBatchIds: string[] = [],
  grantedSubjects: EnrollmentSubjectDto[] = [],
  isAccessBlocked = false,
): EnrollmentDetailDto {
  if (row.batchId && row.batch) {
    return {
      id: row.id,
      kind: EnrollmentKind.BATCH,
      deliveryMode: DeliveryMode.LIVE,
      status: row.status as EnrollmentStatus,
      idNumber: enrollmentIdNumber(row),
      enrolledAt: row.enrolledAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      batch: {
        id: row.batch.id,
        title: row.batch.title,
        courseId: row.batch.courseId,
        endDate: row.batch.endDate?.toISOString() ?? null,
      },
      course: null,
      subjects: mapSubjectsToEnrollmentDto(row.batch.subjects),
      grantedSubjects: grantedSubjects.length ? grantedSubjects : undefined,
      grantedBatchIds: grantedBatchIds.length ? grantedBatchIds : undefined,
      isAccessBlocked,
    }
  }

  return {
    id: row.id,
    kind: EnrollmentKind.COURSE,
    deliveryMode: DeliveryMode.RECORDED,
    status: row.status as EnrollmentStatus,
    idNumber: enrollmentIdNumber(row),
    enrolledAt: row.enrolledAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    batch: null,
    course: { id: row.course!.id, title: row.course!.title },
    modules: row.course!.modules.map((mod) => ({
      id: mod.id,
      title: mod.title,
      order: mod.order,
      lessons: mod.lessons.map((l) => toLessonDto(l)),
    })),
    isAccessBlocked,
  }
}

type AdminEnrollmentRow = Enrollment & {
  student: Pick<User, 'id' | 'name' | 'phone' | 'idNumber'>
  batch:
    | (Pick<Batch, 'id' | 'title' | 'capacity' | 'priceMinor'> & {
        course: Pick<Course, 'id' | 'title'>
        _count: { enrollments: number }
      })
    | null
  course:
    | (Pick<Course, 'id' | 'title' | 'priceMinor'> & {
        _count: { enrollments: number }
      })
    | null
}

export function toAdminEnrollmentRequest(row: AdminEnrollmentRow): AdminEnrollmentRequestDto {
  const kind = row.batchId ? EnrollmentKind.BATCH : EnrollmentKind.COURSE
  const totalEnrollments = row.batch?._count.enrollments ?? row.course?._count.enrollments ?? 0
  const totalSeats = row.batch?.capacity ?? null
  const priceMinor = row.batch?.priceMinor ?? row.course?.priceMinor ?? 0
  const defaultFeeMinor =
    kind === EnrollmentKind.BATCH
      ? priceMinor > 0
        ? Math.min(DEFAULT_FIRST_MONTH_FEE_MINOR, priceMinor)
        : DEFAULT_FIRST_MONTH_FEE_MINOR
      : priceMinor > 0
        ? priceMinor
        : null

  return {
    id: row.id,
    kind,
    status: row.status as EnrollmentStatus,
    idNumber: enrollmentIdNumber(row),
    isBlocked: row.isBlocked,
    isFullyPaid: row.isFullyPaid,
    enrolledAt: row.enrolledAt.toISOString(),
    student: {
      id: row.student.id,
      name: row.student.name,
      phone: row.student.phone,
    },
    batch: row.batch
      ? {
          id: row.batch.id,
          title: row.batch.title,
          course: { id: row.batch.course.id, title: row.batch.course.title },
        }
      : null,
    course: row.course ? { id: row.course.id, title: row.course.title } : null,
    priceMinor,
    defaultFeeMinor,
    totalSeats,
    totalEnrollments,
  }
}
