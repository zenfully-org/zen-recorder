const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

/** First supported audio container/codec for MediaRecorder, or '' to let the browser choose. */
export function pickMimeType(isTypeSupported: (type: string) => boolean): string {
  return PREFERRED_MIME_TYPES.find((type) => isTypeSupported(type)) ?? '';
}
