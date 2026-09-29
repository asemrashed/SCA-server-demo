/**
 * One-time backfill: set Enrollment.idNumber to `SCA - {last 6 of student user id}`.
 *
 *   npm run db:backfill-student-ids
 *   npm run db:backfill-student-ids -- --dry-run
 */
import '../../src/load-env.js'
import { PrismaClient } from '@prisma/client'
import { formatScaStudentId } from '../../src/modules/monthly-payment/monthly-payment.utils.js'

const prisma = new PrismaClient()
const dryRun = process.argv.includes('--dry-run')

async function main() {
  const enrollments = await prisma.enrollment.findMany({
    select: { id: true, studentId: true, idNumber: true },
    orderBy: { enrolledAt: 'asc' },
  })

  const byStudent = new Map<string, { idNumber: string; enrollmentIds: string[]; previous: Set<string | null> }>()

  for (const row of enrollments) {
    const idNumber = formatScaStudentId(row.studentId)
    const entry = byStudent.get(row.studentId) ?? {
      idNumber,
      enrollmentIds: [],
      previous: new Set<string | null>(),
    }
    entry.enrollmentIds.push(row.id)
    entry.previous.add(row.idNumber)
    byStudent.set(row.studentId, entry)
  }

  let updated = 0
  for (const [studentId, { idNumber, enrollmentIds, previous }] of byStudent) {
    const alreadySet = previous.size === 1 && previous.has(idNumber)
    if (alreadySet) continue

    console.log(
      `${dryRun ? '[dry-run] ' : ''}student ${studentId} → ${idNumber} (${enrollmentIds.length} enrollment(s), was: ${[...previous].map((v) => v ?? 'null').join(', ')})`,
    )

    if (!dryRun) {
      const result = await prisma.enrollment.updateMany({
        where: { studentId },
        data: { idNumber },
      })
      updated += result.count
    } else {
      updated += enrollmentIds.length
    }
  }

  console.log(
    dryRun
      ? `Dry run: would update ${updated} enrollment row(s) for ${byStudent.size} student(s).`
      : `Updated ${updated} enrollment row(s) for ${byStudent.size} student(s).`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
