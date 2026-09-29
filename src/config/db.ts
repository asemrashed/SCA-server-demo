import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

/**
 * Recreate the client whenever this module is re-evaluated (tsx/watch).
 * Keeping a long-lived global after `prisma generate` leaves a stale DMMF
 * that rejects new fields like `isFullyPaid`.
 */
function getPrisma(): PrismaClient {
  const previous = globalForPrisma.prisma
  const client = createPrismaClient()
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client
    if (previous && previous !== client) {
      void previous.$disconnect().catch(() => undefined)
    }
  }
  return client
}

export const prisma = getPrisma()
