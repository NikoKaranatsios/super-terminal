# Public project page

Buildless introduction and interactive simulation of the Super Terminal 0.11.0
graph workspace. The page helps visitors evaluate the workflow, understand its
limits and build the macOS app from source.

The demo contains five invented sessions across two fictional projects. It
supports node selection with an adjacent terminal, observed-state filters,
project/model/branch search, parent navigation, worktree inspection, node dragging,
canvas panning, zoom/Fit and keyboard navigation. A reply in the example terminal
changes a waiting agent to Working. Terminal commands are limited to a local
simulation (help, status, clear); arbitrary text is never executed or sent.
Drafts and output stay in page memory and are cleared by reset or reload.
View-only sessions retain their attachment limit.

The installation section supplies prerequisites, copyable source-build commands,
first-run steps and SSH documentation. FAQ answers cover provider accounts,
discovery limits, local data, platform support and the unspecified project license.
No prebuilt installer or project-wide open-source license is implied.

## Local preview and checks

From the repository root:

~~~sh
python3 -m http.server 4389 --bind 127.0.0.1 --directory website
node --check website/site.js
node --test test/website.test.mjs
~~~

The browser fixture needs the repository's installed dependencies and Playwright
Chromium. It serves only the public assets on an isolated loopback port under the
production Content Security Policy. Optional SUPER_TERMINAL_WEBSITE_SCREENSHOTS
selects a local capture directory; SUPER_TERMINAL_AXE_SOURCE selects an installed
axe-core script for additional automated accessibility checks. These paths and
captures are not public assets.

Verified: question/reply state and count changes; per-session drafts; view-only
output; filters/search and empty-state recovery; worktree/parent scenarios;
dragging without accidental selection; panning/zoom/Fit; keyboard node selection
and terminal focus; literal text handling; reset; copy success and denied-clipboard
fallback; FAQ disclosure; unique IDs and fragment targets; 320/390/768/1024px page
overflow; and usable feature/install content without JavaScript. The fixture makes
no external requests and reports no script or CSP errors. Desktop/mobile
screenshots were reviewed. Optional axe checks report no tested A/AA violations
in wide/narrow and filtered/unfiltered views, not full accessibility certification.
These checks do not verify the desktop app.

## Publishing

The existing page is https://super-terminal.romagnolo.eu/ and is linked from
Romagnolo's public project directory. It remains a static project page.

Deploy only these six assets: index.html, styles.css, site.js, favicon.svg,
robots.txt and sitemap.xml. Keep this README, application/backend source, tests,
SSH settings, credentials and workspace records out of the web root.

Use an immutable release directory and retain the current release/configuration
for rollback. Switch the current symlink atomically and recreate only the
dedicated static page container. Check container health, all six origin hashes,
HTTPS content/security headers and exact CSS/JS/favicon/sitemap bytes. Confirm
that /api/state, /.env and /README.md return 404. Cloudflare may add managed
content to HTML and robots.txt; compare original HTML at the origin.
