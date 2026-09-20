-- AlterTable
ALTER TABLE "BirdSale" ADD COLUMN     "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "IngestedSale" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'poultryscale',
    "idempotency_key" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "portion" TEXT NOT NULL,
    "device_sale_date" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "bird_sale_id" TEXT,
    "dismissed_reason" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "IngestedSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IngestedSale_idempotency_key_key" ON "IngestedSale"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "IngestedSale_bird_sale_id_key" ON "IngestedSale"("bird_sale_id");

-- CreateIndex
CREATE INDEX "IngestedSale_status_received_at_idx" ON "IngestedSale"("status", "received_at");

-- AddForeignKey
ALTER TABLE "IngestedSale" ADD CONSTRAINT "IngestedSale_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestedSale" ADD CONSTRAINT "IngestedSale_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "Profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestedSale" ADD CONSTRAINT "IngestedSale_bird_sale_id_fkey" FOREIGN KEY ("bird_sale_id") REFERENCES "BirdSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestedSale" ADD CONSTRAINT "IngestedSale_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "Profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
