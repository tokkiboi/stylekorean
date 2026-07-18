/* Resolve ambiguous source-sheet dates.
   August dates entered without a year belong to the 2025 operating history. */

const baseParseSheetDate = parseSheetDate;

parseSheetDate = function parseSheetDateWithAugustHistory(value) {
  if (!value) return null;

  const text = String(value).trim();
  const match = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);

  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    const suppliedYear = match[3];

    if (month === 8 && !suppliedYear) {
      return new Date(2025, 7, day);
    }
  }

  return baseParseSheetDate(value);
};
