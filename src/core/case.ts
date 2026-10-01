/** Facts taken from the Laura Gao case. These are not modeling choices. */

export const PRESENT_YEAR = 2026;
export const FIRST_PROJECTION_YEAR = 2027;
export const LAST_PROJECTION_YEAR = 2042;
export const DECISION_YEAR = 2033;
export const COMMUNICATION_YEAR = 2031;
export const OPERATING_PAYMENT = 50_000;
export const OPERATING_PAYMENTS = 10;
export const OPERATING_FIRST_YEAR = 2033;
export const OPERATING_LAST_YEAR = 2042;

export const DISCLAIMER =
  "Exploratory output from the Gao Modeling Toolkit under the assumptions currently in the workspace. Not an investment recommendation, not a prescribed operating reserve, and not a facility-contribution decision.";

/** External cash into the portfolio at the beginning of the year. Operating payments are not included. */
export function caseContribution(calendarYear: number): number {
  if (calendarYear === 2027) return 300_000;
  if (calendarYear === 2028) return 150_000;
  return 0;
}

export function yearIndex(calendarYear: number): number {
  return calendarYear - PRESENT_YEAR;
}

export interface TimelineRow {
  calendarYear: number;
  yearIndex: number;
  title: string;
  detail: string;
}

export const CASE_TIMELINE: TimelineRow[] = [
  {
    calendarYear: 2026,
    yearIndex: 0,
    title: "Present",
    detail: "Year 0. No portfolio yet. Living expenses stay outside the portfolio.",
  },
  {
    calendarYear: 2027,
    yearIndex: 1,
    title: "First contribution",
    detail: "Beginning of the year: invest $300,000. No withdrawal.",
  },
  {
    calendarYear: 2028,
    yearIndex: 2,
    title: "Second contribution",
    detail: "Beginning of the year: add $150,000. Nothing further is added or withdrawn before 2033.",
  },
  {
    calendarYear: 2031,
    yearIndex: 5,
    title: "Co-sponsor communication",
    detail: "Describe a credible range for the 2033 facility contribution. No portfolio cash flow.",
  },
  {
    calendarYear: 2033,
    yearIndex: 7,
    title: "Reserve and facility decision",
    detail:
      "Set aside the operating reserve, then decide a facility contribution from what remains. First $50,000 operating payment is due at the beginning of the year.",
  },
  {
    calendarYear: 2042,
    yearIndex: 16,
    title: "Last operating payment",
    detail: "Tenth fixed $50,000 payment, at the beginning of the year. Payments are not inflation-adjusted. Support after 2042 is outside the case.",
  },
];
