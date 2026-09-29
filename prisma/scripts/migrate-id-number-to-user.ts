/**
 * One-time: copy enrollment IDs to User, dedupe, fill gaps, sync enrollments, add unique constraint.
 *
 *   npm run db:migrate-user-ids
 *   npm run db:migrate-user-ids -- --dry-run
 */
import '../../src/load-env.js'
import { PrismaClient } from '@prisma/client'
import {
  allocateStudentIdNumber,
  formatSequentialStudentId,
  parseNumericStudentIdSuffix,
  syncEnrollmentIdNumbers,
} from '../../src/lib/student-id.js'

const prisma = new PrismaClient()
const dryRun = process.argv.includes('--dry-run')

async function main() {
  const students = await prisma.user.findMany({
    where: { role: 'STUDENT', deletedAt: null },
    select: {
      id: true,
      idNumber: true,
      createdAt: true,
      enrollments: {
        where: { idNumber: { not: null }, status: { not: 'CANCELLED' } },
        select: { idNumber: true, enrolledAt: true },
        orderBy: { enrolledAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const assigned = new Map<string, string>()

  for (const student of students) {
    const fromEnrollment = student.enrollments[0]?.idNumber?.trim() ?? null
    const candidate = student.idNumber?.trim() || fromEnrollment
    if (candidate) {
      assigned.set(student.id, candidate)
    }
  }

  const byIdNumber = new Map<string, string[]>()
  for (const [userId, idNumber] of assigned) {
    const list = byIdNumber.get(idNumber) ?? []
    list.push(userId)
    byIdNumber.set(idNumber, list)
  }

  let maxSuffix = 0
  for (const idNumber of byIdNumber.keys()) {
    maxSuffix = Math.max(maxSuffix, parseNumericStudentIdSuffix(idNumber))
  }

  for (const [idNumber, userIds] of byIdNumber) {
    if (userIds.length <= 1) continue
    const [keeper, ...losers] = userIds
    console.log(
      `${dryRun ? '[dry-run] ' : ''}Duplicate "${idNumber}" — keeping ${keeper}, reassigning ${losers.join(', ')}`,
    )
    const used = new Set(assigned.values())
    for (const loserId of losers) {
      maxSuffix += 1
      let newId = formatSequentialStudentId(maxSuffix)
      while (used.has(newId)) {
        maxSuffix += 1
        newId = formatSequentialStudentId(maxSuffix)
      }
      used.add(newId)
      assigned.set(loserId, newId)
      console.log(`  → ${loserId} gets ${newId}`)
    }
  }

  let updatedUsers = 0
  let syncedEnrollments = 0

  for (const student of students) {
    let idNumber = assigned.get(student.id)
    if (!idNumber) {
      idNumber = await allocateStudentIdNumber(student.id)
      console.log(
        `${dryRun ? '[dry-run] ' : ''}New ID for ${student.id}: ${idNumber}`,
      )
    }

    if (student.idNumber !== idNumber) {
      console.log(
        `${dryRun ? '[dry-run] ' : ''}User ${student.id}: ${student.idNumber ?? 'null'} → ${idNumber}`,
      )
      if (!dryRun) {
        await prisma.user.update({
          where: { id: student.id },
          data: { idNumber },
        })
      }
      updatedUsers += 1
    }

    if (!dryRun) {
      syncedEnrollments += await syncEnrollmentIdNumbers(student.id, idNumber)
    } else {
      const count = await prisma.enrollment.count({
        where: { studentId: student.id, status: { not: 'CANCELLED' } },
      })
      syncedEnrollments += count
    }
  }

  if (!dryRun) {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'User_idNumber_key'
        ) THEN
          ALTER TABLE "User" ADD CONSTRAINT "User_idNumber_key" UNIQUE ("idNumber");
        END IF;
      END $$;
    `)
  }

  console.log(
    dryRun
      ? `Dry run: would update ${updatedUsers} user(s), sync ~${syncedEnrollments} enrollment(s).`
      : `Updated ${updatedUsers} user(s), synced ${syncedEnrollments} enrollment(s). Unique constraint applied.`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
