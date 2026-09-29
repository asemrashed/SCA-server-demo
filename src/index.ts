import './load-env.js'
import app from './app.js'
import { env } from './config/env.js'
import { prisma } from './config/db.js'

async function verifyDatabase(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      'Database unreachable at startup. Check Neon is awake, .env DATABASE_URL (pooler), and network.',
    )
    console.error(message)
  }
}

void verifyDatabase()

app.listen(env.PORT, () => {
  console.info(`SCA API listening on http://localhost:${env.PORT}/api`)
})
