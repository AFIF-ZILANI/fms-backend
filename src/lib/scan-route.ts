// The requests one QR scan makes from the phone: look the unit up, then link / move / use it.
// They get their own rate-limit bucket (App.ts) so scanning a big lot can't starve the rest of the app.
const SCAN_ROUTE = /^\/api\/stock-units\/[0-9a-f-]{36}(\/(bind|relocate|use))?$/i;
const ACTION = /\/(bind|relocate|use)$/i;

export const isScanRequest = (method: string, path: string) =>
    SCAN_ROUTE.test(path) && (method === "POST") === ACTION.test(path) && (method === "GET" || method === "POST");
