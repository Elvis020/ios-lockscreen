/**
 * Calculates the current day of the year (1-365/366).
 *
 * @param date - Optional date to calculate from (defaults to current date)
 * @returns Day number (1-365 or 1-366 for leap years)
 */
export function getCurrentDay(date: Date = new Date()): number {
  const now = new Date(date);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const diffTime = now.getTime() - startOfYear.getTime();
  const dayOfYear = Math.floor(diffTime / (24 * 60 * 60 * 1000)) + 1;

  return dayOfYear;
}

/**
 * Gets the current month (1-12) and day of month (1-31)
 */
export function getCurrentMonthAndDay(date: Date = new Date()): {
  month: number;
  day: number;
} {
  return {
    month: date.getMonth() + 1, // JavaScript months are 0-indexed
    day: date.getDate(),
  };
}

/**
 * Gets the number of days in a specific month
 */
export function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Gets the total days in the current year (365 or 366 for leap years)
 */
export function getTotalDaysInYear(date: Date = new Date()): number {
  const year = date.getFullYear();

  return isLeapYear(year) ? 366 : 365;
}

/**
 * Checks if a year is a leap year
 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Gets the year for display purposes
 */
export function getCurrentYear(date: Date = new Date()): number {
  return date.getFullYear();
}

/**
 * Checks if a given day of the year is a weekend
 */
export function isWeekend(
  dayOfYear: number,
  year: number = new Date().getFullYear(),
): boolean {
  const startOfYear = new Date(year, 0, 1);
  const targetDate = new Date(startOfYear);

  targetDate.setDate(startOfYear.getDate() + dayOfYear - 1);
  const dayOfWeek = targetDate.getDay(); // 0 = Sunday, 6 = Saturday

  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * Gets the month number (1-12) for a given day of the year
 */
export function getMonthForDayOfYear(
  dayOfYear: number,
  year: number = new Date().getFullYear(),
): number {
  const startOfYear = new Date(year, 0, 1);
  const targetDate = new Date(startOfYear);

  targetDate.setDate(startOfYear.getDate() + dayOfYear - 1);

  return targetDate.getMonth() + 1; // 1-indexed
}

/**
 * Quarter calculation utilities
 */
export interface QuarterInfo {
  quarter: number; // 1-4
  year: number;
  dayInQuarter: number; // Current day within the quarter (1-based)
  totalDaysInQuarter: number;
  daysLeft: number;
  percentComplete: number;
  startDate: Date;
  endDate: Date;
}

/**
 * Gets the start month (0-indexed) for a given quarter
 */
function getQuarterStartMonth(quarter: number): number {
  return (quarter - 1) * 3; // Q1=0, Q2=3, Q3=6, Q4=9
}

/**
 * Gets comprehensive quarter information for a given date
 */
export function getQuarterInfo(date: Date = new Date()): QuarterInfo {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  const quarter = Math.floor(month / 3) + 1; // 1-4

  // Calculate quarter start and end dates
  const startMonth = getQuarterStartMonth(quarter);
  const startDate = new Date(year, startMonth, 1);

  // End date is the last day of the quarter's third month
  const endMonth = startMonth + 2;
  const endDate = new Date(year, endMonth + 1, 0); // Last day of end month

  // Calculate total days in quarter
  const totalDaysInQuarter =
    Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  // Calculate current day within quarter (1-based)
  const dayInQuarter =
    Math.floor((date.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  const daysLeft = totalDaysInQuarter - dayInQuarter;
  const percentComplete = Math.round((dayInQuarter / totalDaysInQuarter) * 100);

  return {
    quarter,
    year,
    dayInQuarter,
    totalDaysInQuarter,
    daysLeft,
    percentComplete,
    startDate,
    endDate,
  };
}

/**
 * Checks if a given day within a quarter is a weekend
 */
export function isWeekendInQuarter(
  dayInQuarter: number,
  quarterStartDate: Date,
): boolean {
  const targetDate = new Date(quarterStartDate);

  targetDate.setDate(quarterStartDate.getDate() + dayInQuarter - 1);
  const dayOfWeek = targetDate.getDay(); // 0 = Sunday, 6 = Saturday

  return dayOfWeek === 0 || dayOfWeek === 6;
}
