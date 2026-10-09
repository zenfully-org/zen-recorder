/**
 * Whether the encoder failed more times in a row than the lifecycle restarts it. Then nothing
 * restarts or auto-starts until Record is pressed or another meeting starts, so a broken encoder
 * cannot loop or leave a trail of files, and the tab says so instead of looking ready.
 */
export function hasGivenUpOnEncoder(
  state: { encoderFailures: number },
  config: { maxEncoderRestarts: number },
): boolean {
  return state.encoderFailures > config.maxEncoderRestarts;
}
