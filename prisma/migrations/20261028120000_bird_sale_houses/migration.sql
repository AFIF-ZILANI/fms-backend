-- A bird sale can now draw from several houses: the house moves off BirdSale into one
-- BirdSaleHouse row per house, each carrying how many birds came from it.

-- CreateTable
CREATE TABLE "BirdSaleHouse" (
    "id" TEXT NOT NULL,
    "bird_sale_id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "birds_count" INTEGER NOT NULL,

    CONSTRAINT "BirdSaleHouse_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BirdSaleHouse_count_pos" CHECK (birds_count > 0)
);

-- Every existing sale came from exactly one house, with all its birds.
INSERT INTO "BirdSaleHouse" ("id", "bird_sale_id", "house_id", "birds_count")
SELECT gen_random_uuid()::text, "id", "house_id", "birds_count" FROM "BirdSale";

-- CreateIndex
CREATE INDEX "BirdSaleHouse_house_id_idx" ON "BirdSaleHouse"("house_id");

-- CreateIndex
CREATE UNIQUE INDEX "BirdSaleHouse_bird_sale_id_house_id_key" ON "BirdSaleHouse"("bird_sale_id", "house_id");

-- AddForeignKey
ALTER TABLE "BirdSaleHouse" ADD CONSTRAINT "BirdSaleHouse_bird_sale_id_fkey" FOREIGN KEY ("bird_sale_id") REFERENCES "BirdSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirdSaleHouse" ADD CONSTRAINT "BirdSaleHouse_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "Houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "BirdSale" DROP CONSTRAINT "BirdSale_house_id_fkey";

-- AlterTable
ALTER TABLE "BirdSale" DROP COLUMN "house_id";
