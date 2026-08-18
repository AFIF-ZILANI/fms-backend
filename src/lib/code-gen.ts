/**
 * Derives a stable lookup-table `code` from a user-entered `label`. Order
 * matters: stripping special characters before collapsing whitespace avoids
 * a double-underscore artifact when punctuation sits next to a space
 * ("Feed - Type" -> "FEED_TYPE", not "FEED__TYPE"). Called on every
 * create/update in lookup-factory.ts -- code is never client-supplied.
 */
export function generateCode(label: string): string {
    const trimmed = label.trim().toUpperCase();
    const withoutSpecial = trimmed.replace(/[^A-Z0-9\s]/g, "");
    // If there are no alphanumeric characters, return empty string
    if (!/[A-Z0-9]/.test(withoutSpecial)) {
        return "";
    }
    return withoutSpecial.replace(/\s+/g, "_");
}
