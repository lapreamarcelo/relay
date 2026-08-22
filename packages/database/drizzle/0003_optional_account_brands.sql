ALTER TABLE "social_account" ALTER COLUMN "brand_id" DROP NOT NULL;

ALTER TABLE "social_account" DROP CONSTRAINT IF EXISTS "social_account_brand_id_fkey";
ALTER TABLE "social_account" DROP CONSTRAINT IF EXISTS "social_account_brand_id_brand_id_fk";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_account_brand_id_optional_fk'
  ) THEN
    ALTER TABLE "social_account"
      ADD CONSTRAINT "social_account_brand_id_optional_fk"
      FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE SET NULL;
  END IF;
END $$;
