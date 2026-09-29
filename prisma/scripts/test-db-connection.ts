import '../../src/load-env.js'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const result = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`
  console.log('Database connection OK:', result[0]?.ok === 1)
}

main()
  .catch((err: unknown) => {
    console.error('Database connection FAILED')
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
