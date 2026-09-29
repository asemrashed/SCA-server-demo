-- Rename Enrollment.rollNumber to idNumber (human-facing student ID).
ALTER TABLE "Enrollment" RENAME COLUMN "rollNumber" TO "idNumber";
