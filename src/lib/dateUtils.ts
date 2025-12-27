import { DateTime } from 'luxon';
import { IntervalUnit, deriveIntervalFromDays } from '@/hooks/useSubscriptionTiers';

/**
 * Compute next subscription end date using calendar-based intervals.
 * Preserves time-of-day in the specified timezone.
 * 
 * Renewal stacking: extend from max(now, currentEnd if in future)
 * 
 * @param nowISO - Current time as UTC ISO string
 * @param currentEndISO - Current subscription end as UTC ISO string (can be null)
 * @param intervalUnit - Interval unit: 'day', 'week', 'month', 'year'
 * @param intervalCount - Number of units to add
 * @param billingTimezone - IANA timezone (e.g., 'Europe/Moscow')
 * @returns New end date as UTC ISO string
 */
export function computeNextEndISO(
  nowISO: string,
  currentEndISO: string | null,
  intervalUnit: IntervalUnit,
  intervalCount: number,
  billingTimezone: string = 'Europe/Moscow'
): string {
  const nowUTC = DateTime.fromISO(nowISO, { zone: 'utc' });
  const currentEndUTC = currentEndISO 
    ? DateTime.fromISO(currentEndISO, { zone: 'utc' }) 
    : null;

  // Renewal stacking: extend from max(now, currentEnd if in future)
  const startFromUTC = (currentEndUTC && currentEndUTC > nowUTC) ? currentEndUTC : nowUTC;
  
  // Convert to local timezone
  const startLocal = startFromUTC.setZone(billingTimezone);
  
  // Add interval based on unit
  let endLocal: DateTime;
  switch (intervalUnit) {
    case 'week':
      endLocal = startLocal.plus({ weeks: intervalCount });
      break;
    case 'month':
      endLocal = startLocal.plus({ months: intervalCount });
      break;
    case 'year':
      endLocal = startLocal.plus({ years: intervalCount });
      break;
    case 'day':
    default:
      endLocal = startLocal.plus({ days: intervalCount });
      break;
  }
  
  // Convert back to UTC and return as ISO string
  const endUTC = endLocal.toUTC();
  
  console.log(`[computeNextEndISO] nowISO=${nowISO}, currentEndISO=${currentEndISO}, startFromISO=${startFromUTC.toISO()}, interval_unit=${intervalUnit}, interval_count=${intervalCount}, billing_timezone=${billingTimezone}, newEndISO=${endUTC.toISO()}`);
  
  return endUTC.toISO()!;
}

/**
 * Get interval fields from a tier, with fallback to duration_days
 */
export function getTierInterval(tier: {
  interval_unit?: IntervalUnit | null;
  interval_count?: number | null;
  billing_timezone?: string | null;
  duration_days: number;
}): { unit: IntervalUnit; count: number; timezone: string } {
  if (tier.interval_unit != null && tier.interval_count != null) {
    return {
      unit: tier.interval_unit,
      count: tier.interval_count,
      timezone: tier.billing_timezone || 'Europe/Moscow',
    };
  }
  
  // Derive from legacy duration_days
  const derived = deriveIntervalFromDays(tier.duration_days);
  return {
    unit: derived.unit,
    count: derived.count,
    timezone: tier.billing_timezone || 'Europe/Moscow',
  };
}

/**
 * Format a date for display in a specific timezone
 */
export function formatDateInTimezone(
  isoDate: string,
  timezone: string = 'Europe/Moscow',
  format: string = 'd MMMM yyyy'
): string {
  const dt = DateTime.fromISO(isoDate, { zone: 'utc' })
    .setZone(timezone)
    .setLocale('ru');
  
  return dt.toFormat(format);
}
