-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('TASK_ASSIGNED', 'POINTS_GIVEN', 'POINTS_VOIDED', 'PAYSLIP_READY', 'PAYOUT_CONFIRMED', 'PAYOUT_FAILED', 'BONUS_GRANTED', 'PASSWORD_CHANGED', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "Notifications" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "related_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notifications_profile_id_created_at_idx" ON "Notifications"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "Notifications_profile_id_read_at_idx" ON "Notifications"("profile_id", "read_at");

-- AddForeignKey
ALTER TABLE "Notifications" ADD CONSTRAINT "Notifications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "Profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
