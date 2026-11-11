# AGENTS.md

Instructions for coding agents that work on the site **Offing**. This file is written by the build from the site's config and content, so it describes this build. Read it before every task.

## Site

- Title: Offing
- Description: Local-first deprecation intelligence for software repositories.
- URL: https://velella.sh
- Base path: `/offing`
- Default language: `en`, direction `ltr`
- Languages: only the default language

## Where content lives

- Config: `mizzen.yml` at the site root. Every path in it is relative to the site root.
- Source folder: the site root.
- Navigation: `_data/navigation.yml`. Navigation lists in this build: `main`.
- Data files (`_data/`): `navigation`, `reading-time`.
- Edit links: https://github.com/velella-sh/offing, branch `main`, folder `docs`.
- Pages in this build: 1024 rendered from Markdown or HTML, and 1 app page copied as they are.

## Pages

- Each Markdown file (`.md`, `.markdown`) under the source folder is a page. An HTML file is a page only when it starts with front matter.
- A page's URL follows its path: `guide/install.md` is served at `/offing/guide/install/`. `index.md` and `README.md` are served at their folder's URL.
- Front matter `permalink` sets another URL. A URL that names a file, such as `/404.html`, is written as that file.
- Folders whose name starts with `_` are skipped, except `_data`. Names that start with `.` are skipped.
- A folder whose `index.html` has no front matter is an app page: every file in it is copied as it is.
- Front matter keys the engine reads: `title`, `description`, `permalink`, `redirect_from`, `redirect_to`, `lang`, `dir`, `order`, `status`, `agent`, `search`, `published`, `image`, and `translation_key`. Other keys are kept for rendering.
- A folder named after a language's URL prefix (for example `fa/` for the prefix `/fa`) holds that language's pages.

## How to add a page

1. Create `<folder>/<page>.md`. The file name sets the page's address.
2. Start the file with front matter and write plain Markdown after it:

```markdown
---
title: New page
description: One sentence about the page.
---

Plain Markdown here.
```

3. To list the page in navigation, add an item with `title` and `url` to the `docs` list (the sidebar) or the `main` list (the header) in `_data/navigation.yml`. `url` is the page's address, such as `/offing/guide/new-page/`. If that file has no lists, the sidebar is built from the folders instead, ordered by `order` and then by title.
4. Build the site and check the change (see below).

## How to check a change

1. Build the site.
2. Check the source and the build: `npx mizzen doctor . --build <build folder>`.
3. Read every finding. Each one names a file and often a line. Fix it in the source, build again, and repeat until the check is clean.

## Generated files

- Everything the build writes to the build folder is generated: a rendered `index.html` for each page, the copied files, and this `AGENTS.md`. Edit the source, never the build folder.
- An output can be turned off in the config's `outputs` map by its name. `outputs:` with `agents-md: false` removes only this file.

## Never

- Never edit the build folder; the next build replaces it.
- Never invent front matter keys or config keys; use only the ones listed here or in the schema of the config.
- Never change `translation_key` on one translation only; change every page that shares it, or none.
- Never rename a page's file to change its title; set `title`, because the file name is the page's address.
