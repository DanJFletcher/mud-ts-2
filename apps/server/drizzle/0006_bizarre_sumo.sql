CREATE TABLE "world_location_group_catalogs" (
	"pack_id" text NOT NULL,
	"pack_version" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_location_group_catalogs_pk" PRIMARY KEY("pack_id","pack_version"),
	CONSTRAINT "world_location_group_catalogs_revision_nonnegative" CHECK ("world_location_group_catalogs"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "world_location_group_memberships" (
	"pack_id" text NOT NULL,
	"pack_version" text NOT NULL,
	"group_id" text NOT NULL,
	"location_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "world_location_group_memberships_pk" PRIMARY KEY("pack_id","pack_version","group_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "world_location_groups" (
	"pack_id" text NOT NULL,
	"pack_version" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"metadata" jsonb,
	CONSTRAINT "world_location_groups_pk" PRIMARY KEY("pack_id","pack_version","id")
);
--> statement-breakpoint
ALTER TABLE "world_location_group_memberships" ADD CONSTRAINT "world_location_group_memberships_group_fk" FOREIGN KEY ("pack_id","pack_version","group_id") REFERENCES "public"."world_location_groups"("pack_id","pack_version","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_location_groups" ADD CONSTRAINT "world_location_groups_catalog_fk" FOREIGN KEY ("pack_id","pack_version") REFERENCES "public"."world_location_group_catalogs"("pack_id","pack_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_location_group_memberships_location_idx" ON "world_location_group_memberships" USING btree ("pack_id","pack_version","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "world_location_group_one_primary_per_location_idx" ON "world_location_group_memberships" USING btree ("pack_id","pack_version","location_id") WHERE "world_location_group_memberships"."is_primary";