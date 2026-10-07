import { Prisma } from "../../prisma/generated/prisma/client";
import { AppError } from "@lib/app-error";

type Ref = "SALE" | "BIRD_SALE" | "PURCHASE";

/**
 * A sale or purchase can be recorded with money already paid. That cash has to land somewhere the books
 * can see, so it is written as a Payment against an instrument -- exactly like a payment made later --
 * rather than as a number on the record that no balance or cash position ever counts.
 *
 * The record itself is stored as "nothing paid yet" (paid_amount 0, due_amount = what is owed), and the
 * Payment row carries the cash. Every reader (the web's paid/due figures, the dashboard, the summaries)
 * already computes paid = stored paid + payments and due = stored due - payments, so they all agree.
 * That is why the stored paid_amount is 0 on new rows.
 */

/** Fail early, before any write, when money was paid but no account was named. */
export function requirePaidInstrument(paid: Prisma.Decimal, instrument_id: string | undefined, field: string, ref: Ref) {
    if (paid.greaterThan(0) && instrument_id === undefined) {
        const verb = ref === "PURCHASE" ? "paid from" : "paid into";
        throw AppError.badRequest(`Say which account this was ${verb}`, {
            fields: { [field]: `Choose the account the money was ${verb === "paid from" ? "paid from" : "paid into"}` },
        });
    }
}

/** Write the Payment for the amount paid at creation. No-op when nothing was paid. */
export async function recordPaidAtCreate(
    tx: Prisma.TransactionClient,
    p: { ref_type: Ref; ref_id: string; amount: Prisma.Decimal; instrument_id: string | undefined; date: Date; actor_id: string },
) {
    if (!p.amount.greaterThan(0)) return;
    const instrument = p.instrument_id
        ? await tx.paymentInstrument.findUnique({ where: { id: p.instrument_id }, select: { is_active: true, label: true } })
        : null;
    if (!instrument) throw AppError.badRequest("The account named does not exist");
    if (!instrument.is_active) throw AppError.badRequest(`${instrument.label} is inactive -- pick an active account`);

    const incoming = p.ref_type !== "PURCHASE";
    await tx.payment.create({
        data: {
            amount: p.amount,
            payment_date: p.date,
            direction: incoming ? "INCOMING" : "OUTGOING",
            ref_type: p.ref_type,
            ref_id: p.ref_id,
            // Money in names where it landed; money out names where it came from.
            ...(incoming ? { to_instrument_id: p.instrument_id! } : { from_instrument_id: p.instrument_id! }),
            handled_by_id: p.actor_id,
            note: "Paid when recorded",
        },
    });
}
