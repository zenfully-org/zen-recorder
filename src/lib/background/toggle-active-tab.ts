/**
 * The keyboard shortcut starts or stops the recording of the active tab. It runs from the
 * command's listener without being awaited, so it never rejects: a browser that cannot name the
 * active tab is reported to `warn` (Diagnostics).
 */
export async function toggleActiveTab(deps: {
  queryActiveTab: () => Promise<{ id?: number | undefined }[]>;
  toggle: (tabId: number) => unknown;
  warn: (message: string, detail?: unknown) => void;
}): Promise<void> {
  try {
    const [tab] = await deps.queryActiveTab();
    if (tab?.id !== undefined) deps.toggle(tab.id);
  } catch (error) {
    deps.warn('could not find the active tab for the shortcut:', error);
  }
}
