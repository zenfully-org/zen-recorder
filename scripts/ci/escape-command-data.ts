/**
 * The message of a GitHub Actions workflow command (`::error ...::message`), escaped as the runner
 * reads it back: a percent sign, a carriage return and a newline as their percent codes.
 */
export function escapeCommandData(text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}
