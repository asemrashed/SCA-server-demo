-- Detach resources when curriculum nodes are removed instead of deleting resource rows.
ALTER TABLE "Resource" DROP CONSTRAINT IF EXISTS "Resource_moduleId_fkey";
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Resource" DROP CONSTRAINT IF EXISTS "Resource_lessonId_fkey";
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
