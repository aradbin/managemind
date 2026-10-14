ALTER TABLE "platform"."verifications" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "platform"."verifications" ALTER COLUMN "id" SET DEFAULT uuidv7()::text;