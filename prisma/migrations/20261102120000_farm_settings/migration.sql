-- Farm-wide settings, one row. day_start_hour 0 = the day turns at midnight, as before.
CREATE TABLE "FarmSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "day_start_hour" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FarmSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FarmSettings_single_row" CHECK ("id" = 1),
    CONSTRAINT "FarmSettings_day_start_hour_range" CHECK ("day_start_hour" BETWEEN 0 AND 6)
);

INSERT INTO "FarmSettings" ("id", "day_start_hour", "updated_at") VALUES (1, 0, CURRENT_TIMESTAMP);
