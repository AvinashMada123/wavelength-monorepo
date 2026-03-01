/**
 * TRAI compliance: calls to Indian numbers only between 9AM-8PM IST.
 * Uses phone prefix to determine timezone.
 */

const IST_OFFSET_HOURS = 5.5; // IST is UTC+5:30

export function isCallableTime(phoneNumber: string): boolean {
  const now = new Date();

  // India (+91): 9AM-8PM IST
  if (phoneNumber.startsWith('+91') || phoneNumber.startsWith('91')) {
    const istHour = getHourInIST(now);
    return istHour >= 9 && istHour < 20; // 9AM to 8PM
  }

  // For non-Indian numbers, allow all times (no regulation enforced yet)
  return true;
}

export function getNextAvailableCallTime(phoneNumber: string): Date | null {
  if (isCallableTime(phoneNumber)) return null; // Already callable

  const now = new Date();

  if (phoneNumber.startsWith('+91') || phoneNumber.startsWith('91')) {
    const istHour = getHourInIST(now);
    const next9am = new Date(now);

    if (istHour >= 20) {
      // After 8PM — next available is 9AM tomorrow
      next9am.setDate(next9am.getDate() + 1);
    }
    // Set to 9AM IST (3:30 AM UTC)
    next9am.setUTCHours(3, 30, 0, 0);
    return next9am;
  }

  return null;
}

function getHourInIST(date: Date): number {
  // Convert UTC to IST
  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();
  const istTotalMinutes = utcHours * 60 + utcMinutes + IST_OFFSET_HOURS * 60;
  return (istTotalMinutes / 60) % 24;
}
