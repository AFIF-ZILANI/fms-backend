-- The signed-consent requirement for third-party payout accounts is dropped.
-- No row ever carried one, so nothing is lost here.
ALTER TABLE "EmployeePayoutAccount" DROP COLUMN "consent_doc_url";
