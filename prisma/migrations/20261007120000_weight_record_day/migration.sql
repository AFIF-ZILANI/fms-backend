-- WeightRecords.date was a full timestamp, so "one sample per batch+house+day" never actually
-- collided (two samples a minute apart were different keys), and a NULL batch_id escaped the unique
-- entirely. It becomes a plain day.
--
-- Hand-written conversion: the stored value is the client's UTC instant, and the farm is on Dhaka
-- time (UTC+6), so a sample weighed at 05:00 Dhaka is 23:00 UTC the day before. Shifting by six hours
-- first puts each existing row on the day it was actually weighed, which a bare cast would not.
ALTER TABLE "WeightRecords"
  ALTER COLUMN "date" SET DATA TYPE DATE USING (("date" + interval '6 hours')::date);

-- One no-batch weighing per house per day (the composite unique can't see NULL batch_ids).
CREATE UNIQUE INDEX "WeightRecords_house_date_nobatch_key" ON "WeightRecords"("house_id", "date") WHERE (batch_id IS NULL);
