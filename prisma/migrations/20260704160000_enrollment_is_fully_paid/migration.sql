-- Track enrollments paid in full (no monthly payment blocking).
ALTER TABLE "Enrollment" ADD COLUMN "isFullyPaid" BOOLEAN NOT NULL DEFAULT false;
