/**
 * Derives a human-friendly display name from an email address, since Privy's
 * email-OTP login never collects a real name. "jane.doe@gmail.com" -> "Jane Doe",
 * "kwame_asante99@yahoo.com" -> "Kwame Asante", "info@energitoken.com" -> "Info".
 *
 * Purely cosmetic -- never used as an identifier, only ever displayed.
 */
export function displayNameFromEmail(email: string | null): string {
  if (!email) return "Guest";
  const localPart = email.split("@")[0] ?? "";
  const words = localPart
    .replace(/[0-9]+/g, " ")
    .split(/[._-]+/)
    .map((w) => w.trim())
    .filter(Boolean);

  if (words.length === 0) return "Guest";

  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
