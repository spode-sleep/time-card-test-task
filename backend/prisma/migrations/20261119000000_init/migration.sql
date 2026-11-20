BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "position" VARCHAR(100) NOT NULL,
    "avatar_url" TEXT,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_templates" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,
    "end_day_offset" SMALLINT NOT NULL DEFAULT 0,
    "color" VARCHAR(7) NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "time_zone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignments" (
    "id" UUID NOT NULL,
    "schedule_id" INTEGER NOT NULL DEFAULT 1,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,
    "end_day_offset" SMALLINT NOT NULL DEFAULT 0,
    "template_id" UUID,
    "color" VARCHAR(7) NOT NULL,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_publications" (
    "id" UUID NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_requests" (
    "request_id" UUID NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_requests_pkey" PRIMARY KEY ("request_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shift_templates_code_key" ON "shift_templates"("code");

-- CreateIndex
CREATE INDEX "shift_assignments_schedule_id_date_idx" ON "shift_assignments"("schedule_id", "date");

-- CreateIndex
CREATE INDEX "shift_assignments_template_id_idx" ON "shift_assignments"("template_id");

-- CreateIndex
CREATE INDEX "shift_assignments_employee_id_idx" ON "shift_assignments"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "shift_assignments_schedule_id_employee_id_date_key" ON "shift_assignments"("schedule_id", "employee_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_publications_schedule_id_revision_key" ON "schedule_publications"("schedule_id", "revision");

-- CreateIndex
CREATE INDEX "schedule_requests_schedule_id_idx" ON "schedule_requests"("schedule_id");

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "shift_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_publications" ADD CONSTRAINT "schedule_publications_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_requests" ADD CONSTRAINT "schedule_requests_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain constraints are maintained here because Prisma does not express CHECK clauses.
ALTER TABLE "employees"
    ADD CONSTRAINT "employees_full_name_check" CHECK (length(btrim("full_name")) > 0),
    ADD CONSTRAINT "employees_position_check" CHECK (length(btrim("position")) > 0),
    ADD CONSTRAINT "employees_sort_order_check" CHECK ("sort_order" >= 0);

ALTER TABLE "shift_templates"
    ADD CONSTRAINT "shift_templates_name_check" CHECK (length(btrim("name")) > 0),
    ADD CONSTRAINT "shift_templates_code_check" CHECK (length(btrim("code")) > 0),
    ADD CONSTRAINT "shift_templates_sort_order_check" CHECK ("sort_order" >= 0),
    ADD CONSTRAINT "shift_templates_color_check" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
    ADD CONSTRAINT "shift_templates_time_check" CHECK (
        "start_minute" BETWEEN 0 AND 1439 AND
        "end_minute" BETWEEN 0 AND 1439 AND (
            ("end_day_offset" = 0 AND "end_minute" > "start_minute") OR
            ("end_day_offset" = 1 AND "end_minute" < "start_minute")
        )
    );

ALTER TABLE "schedules"
    ADD CONSTRAINT "schedules_singleton_check" CHECK ("id" = 1),
    ADD CONSTRAINT "schedules_revision_check" CHECK ("revision" >= 0),
    ADD CONSTRAINT "schedules_time_zone_check" CHECK (length(btrim("time_zone")) > 0);

ALTER TABLE "shift_assignments"
    ADD CONSTRAINT "shift_assignments_date_check" CHECK ("date" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
    ADD CONSTRAINT "shift_assignments_color_check" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
    ADD CONSTRAINT "shift_assignments_time_check" CHECK (
        "start_minute" BETWEEN 0 AND 1439 AND
        "end_minute" BETWEEN 0 AND 1439 AND (
            ("end_day_offset" = 0 AND "end_minute" > "start_minute") OR
            ("end_day_offset" = 1 AND "end_minute" < "start_minute")
        )
    );

ALTER TABLE "schedule_publications"
    ADD CONSTRAINT "schedule_publications_revision_check" CHECK ("revision" > 0),
    ADD CONSTRAINT "schedule_publications_snapshot_check" CHECK (
        jsonb_typeof("snapshot") = 'object' AND
        "snapshot" @> jsonb_build_object('schemaVersion', 1, 'revision', "revision")
    );

ALTER TABLE "schedule_requests"
    ADD CONSTRAINT "schedule_requests_kind_check" CHECK ("kind" IN ('save', 'publish')),
    ADD CONSTRAINT "schedule_requests_payload_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "schedule_requests_response_check" CHECK (jsonb_typeof("response") = 'object');

INSERT INTO "schedules" ("id") VALUES (1);

COMMIT;
