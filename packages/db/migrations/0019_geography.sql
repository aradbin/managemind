CREATE SCHEMA "ref";
--> statement-breakpoint
CREATE TABLE "ref"."areas" (
	"id" integer PRIMARY KEY NOT NULL,
	"district_id" smallint NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"name_bn" text NOT NULL,
	"name_en" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "areas_code_unique" UNIQUE("code"),
	CONSTRAINT "areas_district_id_unique" UNIQUE("district_id","id"),
	CONSTRAINT "areas_kind_valid" CHECK ("ref"."areas"."kind" in ('upazila', 'thana'))
);
--> statement-breakpoint
CREATE TABLE "ref"."districts" (
	"id" smallint PRIMARY KEY NOT NULL,
	"division_id" smallint NOT NULL,
	"code" text NOT NULL,
	"name_bn" text NOT NULL,
	"name_en" text NOT NULL,
	CONSTRAINT "districts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ref"."divisions" (
	"id" smallint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_bn" text NOT NULL,
	"name_en" text NOT NULL,
	CONSTRAINT "divisions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "ref"."areas" ADD CONSTRAINT "areas_district_fk" FOREIGN KEY ("district_id") REFERENCES "ref"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref"."districts" ADD CONSTRAINT "districts_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "ref"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "districts_division_idx" ON "ref"."districts" USING btree ("division_id");