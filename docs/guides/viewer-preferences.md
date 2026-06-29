# Viewer preferences

> **New in v1.4.0.** Control how a conforming reader **presents** your PDF the
> moment it opens — initial page layout, the bookmark/thumbnail panel, full-screen
> kiosk mode, window fit/centering, UI-chrome visibility, reading direction, and
> print scaling. Set via `DocumentParams.layout.viewerPreferences`. Purely
> presentational, PDF/A-safe, and zero overhead when unused.

## TL;DR

```ts
import { buildDocumentPDFBytes } from 'pdfnative';
import type { ViewerPreferences } from 'pdfnative';

const viewerPreferences: ViewerPreferences = {
  pageLayout: 'twoColumnLeft',  // continuous two-up, odd pages left
  pageMode: 'useOutlines',      // open the bookmark panel
  displayDocTitle: true,        // titlebar shows /Info /Title, not the filename
  fitWindow: true,
  centerWindow: true,
};

const bytes = buildDocumentPDFBytes({
  title: 'Annual Report',
  blocks: [/* … */],
  outline: 'auto',
  layout: { viewerPreferences },
});
```

## Page layout (`/PageLayout`)

How pages are arranged in the viewport:

| Value | Behaviour |
|---|---|
| `singlePage` | One page at a time |
| `oneColumn` | Continuous single column |
| `twoColumnLeft` / `twoColumnRight` | Continuous two columns; odd pages on the left / right |
| `twoPageLeft` / `twoPageRight` | Two pages at a time; odd pages on the left / right |

## Page mode (`/PageMode`)

Which panel (if any) is open and whether the document opens full-screen:

| Value | Behaviour |
|---|---|
| `useNone` | Neither bookmarks nor thumbnails |
| `useOutlines` | Bookmark panel open |
| `useThumbs` | Thumbnail panel open |
| `fullScreen` | Full-screen presentation, no menu/panel |
| `useOC` | Optional-content (layers) panel |
| `useAttachments` | Attachments panel |

An explicit `pageMode` **overrides** the `/UseOutlines` default that a document
automatically gets when it has an `outline`.

## ViewerPreferences flags

| Field | Effect |
|---|---|
| `hideToolbar` | Hide the reader tool bars |
| `hideMenubar` | Hide the menu bar |
| `hideWindowUI` | Hide scrollbars / navigation, leaving only the page |
| `fitWindow` | Resize the window to the first page |
| `centerWindow` | Centre the window on screen |
| `displayDocTitle` | Show `/Info /Title` in the titlebar instead of the filename |
| `nonFullScreenPageMode` | Mode to use after exiting full-screen |
| `direction` | `'l2r'` (default) or `'r2l'` reading order |
| `printScaling` | `'none'` or `'appDefault'` print-dialog default |

## Full-screen kiosk

```ts
const viewerPreferences: ViewerPreferences = {
  pageMode: 'fullScreen',
  nonFullScreenPageMode: 'useThumbs',
  hideToolbar: true,
  hideMenubar: true,
  direction: 'r2l',
  printScaling: 'none',
};
```

## PDF/A note

Viewer preferences are metadata only — no transparency, no scripting — so they
are safe to combine with any PDF/A conformance level. Sample generators:
[viewer-prefs-showcase.ts](https://github.com/Nizoka/pdfnative/blob/main/scripts/generators/viewer-prefs-showcase.ts).
