-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('APPOINTED', 'PROBATION', 'CONFIRMED', 'TERMINATED');

-- AlterTable
ALTER TABLE "Employees" ADD COLUMN     "date_of_birth" TIMESTAMP(3),
ADD COLUMN     "education" TEXT,
ADD COLUMN     "emergency_name" TEXT,
ADD COLUMN     "emergency_phone" TEXT,
ADD COLUMN     "emergency_relation" TEXT,
ADD COLUMN     "employment_status" "EmploymentStatus" NOT NULL DEFAULT 'APPOINTED',
ADD COLUMN     "experience" TEXT,
ADD COLUMN     "marital_status" "MaritalStatus",
ADD COLUMN     "nid_number" TEXT,
ADD COLUMN     "probation_end_date" TIMESTAMP(3),
ADD COLUMN     "reference_name" TEXT,
ADD COLUMN     "reference_phone" TEXT,
ADD COLUMN     "reference_relation" TEXT;
