-- Schema nothing reads or writes (grepped across server, web and mobile; the data checks found all of
-- it empty): the unused ContactMethods enum, a CASH-receipt column on payouts (cash payouts do not
-- exist -- PayoutMethod has no live CASH path), and a doctor rating no screen shows.
DROP TYPE "ContactMethods";
ALTER TABLE "EmployeePayout" DROP COLUMN "receipt_doc_url";
ALTER TABLE "Doctors" DROP COLUMN "rating";
