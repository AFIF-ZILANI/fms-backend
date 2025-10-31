/**
 * Generate a standardized, unique batch ID for ZeroD Farms.
 *
 * Format:
 *   ZF-{FARM_CODE}-{SECTOR_CODE}-{PRODUCT_CODE}-{YYYYMMDD}-{BATCH_NO}
 *
 * Example:
 *   ZF-F01-POU-BRL-20251031-001
 *
 * Rules:
 * - FARM_CODE: 2+ uppercase alphanumeric (e.g. F01, A12)
 * - SECTOR_CODE: 3 uppercase letters (e.g. POU, FIS, AGR, DAI)
 * - PRODUCT_CODE: 3 uppercase letters (e.g. BRL, TIL, RIC, MIL)
 * - YYYYMMDD: current date
 * - BATCH_NO: zero-padded (e.g. 001, 002, ...)
 *
 * @param farmCode - Farm identifier (e.g. "F01")
 * @param sectorCode - Sector code (e.g. "POU", "FIS", "AGR")
 * @param productCode - Product code (e.g. "BRL", "TIL", "RIC")
 * @param lastBatchNo - Optional: last used batch number (auto-increments)
 * @returns {string} Generated batch ID
 * @throws {Error} if any code fails validation
 */
export function generateBatchId(
    farmCode: string,
    sectorCode: string,
    productCode: string,
    lastBatchNo: number = 0
): string {
    const PREFIX = "ZF";

    // --- Validation ---
    const farmPattern = /^[A-Z0-9]{2,}$/;
    const codePattern = /^[A-Z]{3}$/;

    if (!farmPattern.test(farmCode))
        throw new Error(
            "Invalid FARM_CODE: must be 2+ uppercase alphanumeric (e.g. F01)."
        );
    if (!codePattern.test(sectorCode))
        throw new Error(
            "Invalid SECTOR_CODE: must be 3 uppercase letters (e.g. POU)."
        );
    if (!codePattern.test(productCode))
        throw new Error(
            "Invalid PRODUCT_CODE: must be 3 uppercase letters (e.g. BRL)."
        );

    // --- Date ---
    const date = new Date();
    const YYYYMMDD =
        date.toISOString().split("T")?.[0]?.replace(/-/g, "") ?? ""; // 20251031

    // --- Batch Number ---
    const nextBatchNo = String(lastBatchNo + 1).padStart(3, "0");

    // --- Construct ID ---
    const batchId = `${PREFIX}-${farmCode}-${sectorCode}-${productCode}-${YYYYMMDD}-${nextBatchNo}`;

    return batchId;
}

/**
 * Validate a batch ID against the universal format.
 *
 * @param id - Batch ID string to validate.
 * @returns {boolean} True if valid, false otherwise.
 */
export function validateBatchId(id: string): boolean {
    const regex = /^ZF-[A-Z0-9]{2,}-[A-Z]{3}-[A-Z]{3}-\d{8}-\d{3,}$/;
    return regex.test(id);
}

// --- Example Usage ---
const newId = generateBatchId("F01", "POU", "BRL", 12);
console.log(newId); // ZF-F01-POU-BRL-20251031-013

console.log(validateBatchId(newId)); // true
