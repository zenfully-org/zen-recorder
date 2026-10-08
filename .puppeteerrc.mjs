// Puppeteer: never download Chrome. The e2e run drives the Firefox of `pnpm setup:firefox`, or
// the one E2E_FIREFOX names.
export default { skipDownload: true };
