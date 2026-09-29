import type { Prisma } from '@prisma/client'
import type { z } from 'zod'
import { prisma } from '../../config/db.js'
import { notFound, validationError } from '../../lib/errors.js'
import { Role } from '../../shared/enums.js'
import { isStaff } from '../../shared/roles.js'
import { subjectInputSchema } from '../../shared/schemas/course.js'
import type {
  applyBatchCurriculumSchema,
} from '../../shared/schemas/batch-curriculum.js'
import {
  stripCurriculumIds,
  syncBatchCurriculum,
  validateBatchCurriculumIds,
} from '../curriculum/curriculum-sync.js'
import {
  toCurriculumSubjects,
  type CurriculumSubjectDto,
} from './batch.curriculum.mapper.js'

type SubjectInput = z.infer<typeof subjectInputSchema>
type ApplyBatchCurriculumInput = z.infer<typeof applyBatchCurriculumSchema>

const subjectTreeInclude = {
  modules: {
    orderBy: { order: 'asc' as const },
    include: {
      lessons: { orderBy: { order: 'asc' as const } },
    },
  },
} satisfies Prisma.SubjectInclude

export async function getBatchCurriculum(
  batchId: string,
  role?: Role,
): Promise<CurriculumSubjectDto[]> {
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, deletedAt: null },
    include: {
      subjects: {
        orderBy: { order: 'asc' as const },
        include: subjectTreeInclude,
      },
    },
  })
  if (!batch) {
    throw notFound('Batch not found')
  }
  return toCurriculumSubjects(batch.subjects, role ? isStaff(role) : false)
}

export async function replaceBatchCurriculum(
  batchId: string,
  subjects: SubjectInput[],
): Promise<CurriculumSubjectDto[]> {
  const batch = await prisma.batch.findFirst({ where: { id: batchId, deletedAt: null } })
  if (!batch) {
    throw notFound('Batch not found')
  }
  await validateBatchCurriculumIds(batchId, subjects)
  await syncBatchCurriculum(batchId, subjects)
  return getBatchCurriculum(batchId, Role.ADMIN)
}

export async function applyCurriculumToBatches(
  courseId: string,
  input: ApplyBatchCurriculumInput,
): Promise<void> {
  const batches = await prisma.batch.findMany({
    where: { id: { in: input.batchIds }, courseId, deletedAt: null },
    select: { id: true },
  })
  if (batches.length !== input.batchIds.length) {
    throw validationError('One or more batch IDs are invalid for this course')
  }

  for (const batch of batches) {
    const subjects =
      input.batchIds.length > 1 ? stripCurriculumIds(input.subjects) : input.subjects
    await validateBatchCurriculumIds(batch.id, subjects)
    await syncBatchCurriculum(batch.id, subjects)
  }
}

export async function loadSubjectsForBatchIds(batchIds: string[]) {
  if (!batchIds.length) return []
  return prisma.subject.findMany({
    where: { batchId: { in: batchIds } },
    orderBy: { order: 'asc' },
    include: subjectTreeInclude,
  })
}
