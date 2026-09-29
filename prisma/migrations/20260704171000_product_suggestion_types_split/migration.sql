-- Replace combined MATH_THEORY_SUGGESTION with separate MATH_SUGGESTION and THEORY_SUGGESTION.
CREATE TYPE "ProductType_new" AS ENUM (
  'BOOK',
  'NOTES',
  'QUESTION_BANK',
  'MATH_SUGGESTION',
  'THEORY_SUGGESTION',
  'OTHER'
);

ALTER TABLE "Product" ALTER COLUMN "type" DROP DEFAULT;

ALTER TABLE "Product"
  ALTER COLUMN "type" TYPE "ProductType_new"
  USING (
    CASE
      WHEN "type"::text = 'MATH_THEORY_SUGGESTION' THEN 'MATH_SUGGESTION'::"ProductType_new"
      ELSE "type"::text::"ProductType_new"
    END
  );

ALTER TABLE "Product" ALTER COLUMN "type" SET DEFAULT 'BOOK'::"ProductType_new";

DROP TYPE "ProductType";
ALTER TYPE "ProductType_new" RENAME TO "ProductType";
