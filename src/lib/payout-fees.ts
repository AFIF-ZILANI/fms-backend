import { Prisma } from "../../prisma/generated/prisma/client";
import type { PayoutMethod } from "@validators/employee-payout-account.validator";

/**
 * What it costs the farm to send one wage, by destination. The farm absorbs
 * this rather than netting it off the transfer -- see the Labour Act note in
 * docs/employee-payroll-design.md.
 *
 * Both parts exist because real tariffs use both: BEFTN is free, MFS
 * send-money is a flat charge per transaction, and an MFS *business
 * disbursement* package is a percentage. A farm on a disbursement contract
 * moves the number from `flat` to `percent` here and nothing else changes.
 *
 * ponytail: a constant, not a table -- rates change a few times a year and are
 * the same for every employee, so there is nothing to store per row and no
 * admin screen worth building. If the farm ever runs two providers on
 * different contracts at once, this becomes a table.
 *
 * VERIFY BEFORE THE FIRST RUN. These are the published personal-account rates
 * as understood at the time of writing; a signed disbursement agreement
 * overrides them and bKash/Nagad both revise theirs.
 */
export const PAYOUT_FEES: Record<PayoutMethod, { percent: number; flat: number }> = {
    BANK: { percent: 0, flat: 0 }, // BEFTN credit -- no charge to the sender
    BKASH: { percent: 0, flat: 5 }, // Send Money from a personal account
    NAGAD: { percent: 0, flat: 5 },
    ROCKET: { percent: 0, flat: 5 },
};

/**
 * Decimal rather than float: this figure is written to a money column and
 * summed into the P&L, and 0.1 + 0.2 has no business being anywhere near it.
 */
export function transferFee(method: string, amount: Prisma.Decimal | number) {
    // Any method with no published rate costs the farm nothing -- which is true
    // of the one that can still appear, the historical CASH row.
    const { percent, flat } = PAYOUT_FEES[method as PayoutMethod] ?? { percent: 0, flat: 0 };
    return new Prisma.Decimal(amount)
        .times(percent)
        .dividedBy(100)
        .plus(flat)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
