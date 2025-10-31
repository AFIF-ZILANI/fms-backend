-- AddForeignKey
ALTER TABLE "Medications" ADD CONSTRAINT "Medications_administered_by_fkey" FOREIGN KEY ("administered_by") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
