import type { Context } from "hono";
import { getActorId } from "@lib/current-actor";
import { withHandler } from "@lib/helper";
import { sendSuccess, sendList } from "@lib/response";
import { getValid } from "@lib/valid";
import { BonusEventService } from "@services/bonus-event.service";
import type {
    CreateBonusEventInput,
    GrantBonusesInput,
    ListBonusEventsQuery,
} from "@validators/bonus-event.validator";

export const BonusEventController = {
    async getAll(c: Context) {
        return withHandler(c, async () => {
            const { events, meta } = await BonusEventService.getAll(
                getValid<ListBonusEventsQuery>(c, "query"),
            );
            return sendList(c, events, meta, "Bonus events fetched successfully");
        });
    },

    async getById(c: Context) {
        return withHandler(c, async () => {
            const event = await BonusEventService.getById(c.req.param("id") ?? "");
            return sendSuccess(c, event, "Bonus event fetched successfully");
        });
    },

    async create(c: Context) {
        return withHandler(c, async () => {
            const event = await BonusEventService.create(
                getValid<CreateBonusEventInput>(c, "json"),
                await getActorId(c),
            );
            return sendSuccess(c, event, "Bonus event created", 201);
        });
    },

    async proposal(c: Context) {
        return withHandler(c, async () => {
            const proposal = await BonusEventService.proposal(c.req.param("id") ?? "");
            return sendSuccess(c, proposal, "Proposal computed");
        });
    },

    async grant(c: Context) {
        return withHandler(c, async () => {
            const bonuses = await BonusEventService.grant(
                c.req.param("id") ?? "",
                getValid<GrantBonusesInput>(c, "json"),
                await getActorId(c),
            );
            return sendSuccess(c, bonuses, "Bonuses granted", 201);
        });
    },
};
