-- Add permanent student ID on User (backfill + unique index applied via npm run db:migrate-user-ids).
ALTER TABLE "User" ADD COLUMN "idNumber" TEXT;

CREATE INDEX "User_idNumber_idx" ON "User"("idNumber");
