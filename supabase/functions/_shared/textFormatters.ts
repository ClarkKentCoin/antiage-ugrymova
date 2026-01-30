/**
 * Russian Pluralization Helpers for Edge Functions
 * 
 * Handles grammatical cases for Russian nouns that change form
 * based on the preceding number.
 */

/**
 * Get the correct Russian word form for "день" (day)
 * 
 * Rules:
 * - 11-14 always use "дней" (genitive plural)
 * - Last digit 1 uses "день" (nominative singular)
 * - Last digit 2-4 uses "дня" (genitive singular)
 * - All other cases use "дней" (genitive plural)
 * 
 * Examples:
 * - 1 → "день"
 * - 2 → "дня"
 * - 5 → "дней"
 * - 11 → "дней"
 * - 21 → "день"
 * - 22 → "дня"
 * - 25 → "дней"
 */
export function getDayWordRu(n: number): "день" | "дня" | "дней" {
  const mod100 = Math.abs(n) % 100;
  const mod10 = Math.abs(n) % 10;

  // Special case for 11-14
  if (mod100 >= 11 && mod100 <= 14) {
    return "дней";
  }

  // Check last digit
  if (mod10 === 1) {
    return "день";
  }

  if (mod10 >= 2 && mod10 <= 4) {
    return "дня";
  }

  return "дней";
}

/**
 * Format number with correct Russian pluralization for "день"
 * Returns string like "1 день", "2 дня", "5 дней"
 */
export function formatDaysRu(n: number): string {
  return `${n} ${getDayWordRu(n)}`;
}
