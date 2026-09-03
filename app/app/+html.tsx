import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

/**
 * The web build's HTML shell.
 *
 * Expo Router serves a default shell when this file is absent, and that
 * default does not constrain the document horizontally. On a phone that let
 * the page pan left and right: any single element wider than the viewport --
 * a chart sized from a stale measurement, a row of cards whose minWidth
 * cannot shrink far enough, an SVG drawn before layout settles -- makes the
 * whole document scrollable sideways, so the app appears to drift and stretch
 * rather than sit still.
 *
 * Fixing individual overflowing children matters and is done separately, but
 * a single one reintroduces the behaviour for the entire app. Constraining the
 * document itself means a future overflow is clipped or wrapped rather than
 * turning the whole page into a horizontally scrollable canvas.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/*
          viewport-fit=cover so the layout reaches under a notch rather than
          being letterboxed; maximum-scale is deliberately NOT set, since
          preventing zoom is an accessibility regression for anyone who needs
          to enlarge text.
        */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#0F1115" />

        {/* Expo's own reset: stops the body scrolling independently of the
            app's ScrollViews, which otherwise produces two nested scrollbars
            on web. */}
        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: responsiveShell }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveShell = `
html, body, #root {
  max-width: 100%;
  /* The actual fix for the sideways drift. Vertical scrolling is untouched. */
  overflow-x: hidden;
}
body {
  margin: 0;
  /* Stops iOS Safari inflating text in landscape, which silently widens
     layouts that were measured in portrait. */
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
/* An image or SVG that reports a larger intrinsic size than its container is
   the most common way a single element widens the whole document. */
img, svg, canvas, video {
  max-width: 100%;
}
`;
