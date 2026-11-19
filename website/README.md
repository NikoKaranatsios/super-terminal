# Public project page

Buildless static introduction to Super Terminal. Serve this directory with any
static HTTP server; no desktop dependencies or application service are needed.

```sh
python3 -m http.server 4389 --bind 127.0.0.1 --directory website
```

The page describes the published desktop baseline. The workspace preview uses
invented example content and makes no requests to agent providers. It supports
agent selection, keyboard-accessible preview tabs, and copying install commands
where the browser supports the Clipboard API. Installation, documentation, and
issue links point to the public repository; no prebuilt download is advertised.
The page identifies the missing project license without granting a license.

Public files: `index.html`, `styles.css`, `site.js`, `favicon.svg`, `robots.txt`,
and `sitemap.xml`. Deploy only these files. The application backend, SSH settings,
provider credentials, workspace data, and development files are not web assets.

Validation: JavaScript syntax, relative assets and anchor targets, responsive
browser review, preview tab/agent interactions, installation copy, and deployed
HTTPS responses. These checks verify the project page, not the desktop app.
