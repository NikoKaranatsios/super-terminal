# Public project page

Buildless static introduction to Super Terminal. Serve this directory with any
static HTTP server; no desktop dependencies or application service are needed.

```sh
python3 -m http.server 4389 --bind 127.0.0.1 --directory website
```

The page describes the `0.11.0` desktop graph workspace. The workspace preview uses
invented example content and makes no requests to agent providers. It supports
graph-node and agent selection, keyboard-accessible preview tabs, and copying install commands
where the browser supports the Clipboard API. Installation, documentation, and
issue links point to the public repository; no prebuilt download is advertised.
The page identifies the missing project license without granting a license.

Public files: `index.html`, `styles.css`, `site.js`, `favicon.svg`, `robots.txt`,
and `sitemap.xml`. Deploy only these files. The application backend, SSH settings,
provider credentials, workspace data, and development files are not web assets.

## Verification

The published page is available at https://super-terminal.romagnolo.eu/ and is
listed in Romagnolo's public project directory.

Passed: JavaScript syntax; unique HTML IDs; local assets and fragment targets;
Git whitespace checks; deployed HTTPS and security headers; exact public CSS,
JavaScript and favicon content; origin HTML matching the committed source;
sitemap availability; public project-directory entry; and HTTP 404 responses for
the application API, `.env`, and the development README. The static container's
health check passes. Cloudflare adds managed content to HTML and `robots.txt`.

Isolated browser checks pass for graph-node selection, all example providers,
keyboard tab navigation, HTML IDs/fragment links, and no page overflow at 320/390
CSS pixels. Desktop and mobile screenshots were reviewed; the graph scrolls
within its own viewport on narrow screens. The installation-copy button retains
its existing browser-dependent behavior. This page's checks do not verify the
desktop app. No prebuilt release or project-wide open-source license is implied.
