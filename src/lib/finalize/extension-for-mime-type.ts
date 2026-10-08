/** File extension for a MediaRecorder mime type. */
export function extensionForMimeType(mimeType: string): string {
  return mimeType.toLowerCase().startsWith('audio/ogg') ? 'ogg' : 'webm';
}
