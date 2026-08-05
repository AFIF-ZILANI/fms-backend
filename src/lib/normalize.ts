/** Dedup key for name-like fields ("Amoxicillin" and "amoxicillin" -> same key). */
export const normalizeKey = (value: string): string =>
    value.trim().toLowerCase().replace(/\s+/g, " ");
