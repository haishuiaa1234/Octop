import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export function feedbackDateRange(
  start: string | undefined,
  end: string | undefined,
  zone: string,
) {
  if (start && end && start > end) throw new Error("Invalid date range");
  return {
    start_time: start ? dayjs.tz(start, zone).unix() : undefined,
    // Construct the next calendar date before applying timezone, including DST days.
    end_time: end
      ? dayjs.tz(dayjs.utc(end).add(1, "day").format("YYYY-MM-DD"), zone).unix()
      : undefined,
  };
}
