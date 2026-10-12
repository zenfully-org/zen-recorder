/**
 * The page of the second store screenshot, 1280 by 800: the call as the meeting tab shows it,
 * and the toolbar popup over it where Firefox opens its panel, under the toolbar button at the
 * top right, with the panel's rounded corners and shadow. Both pictures are image URLs; the
 * popup's size is its drawn size, already scaled.
 */
export function renderPopupOverCall({
  call,
  popup,
}: {
  call: string;
  popup: { src: string; width: number; height: number };
}): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Popup over the call</title><style>
  html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
  .call { position: absolute; top: 0; left: 0; }
  .popup { position: absolute; top: 12px; right: 24px; border-radius: 8px;
    border: 1px solid #cfd3db; box-shadow: 0 6px 24px rgb(0 0 0 / 35%); }
</style></head>
<body>
  <img class="call" src="${call}" width="1280" height="800" alt="The meeting tab">
  <img class="popup" src="${popup.src}" width="${popup.width}" height="${popup.height}" alt="The toolbar popup">
</body></html>
`;
}
