---
title: Distribution brand checklist
---

# Distribution brand checklist

Use this checklist whenever Offing is added to or updated on a public surface.
The approved source of truth is the
[brand files](https://github.com/velella-sh/offing/blob/main/brand/README.md);
do not redesign the identity for an individual channel.

## Universal checks

- [ ] Use `Offing` as the display name and `offing` only where a
      package or machine identifier is required.
- [ ] Use the tagline exactly as `See what's in the offing. Fix it before it lands.`
- [ ] Use the descriptor exactly as `Local-first end-of-life and deprecation
      scanner for your repository.` when category clarity is required.
- [ ] Use `Evidence-backed migration context for humans and coding agents.` only
      as the approved supporting message.
- [ ] Select an approved dark, light, or monochrome asset; never redraw the mark.
- [ ] Preserve clear space, minimum size, and accessible color pairs.
- [ ] Keep official brand content in English and omit personal attribution.
- [ ] Link to the official repository, documentation, and package.
- [ ] Confirm the surface does not imply hosted analysis, automatic code changes,
      complete ecosystem coverage, or guaranteed migration safety.
- [ ] Re-check the platform's current image and metadata specifications before
      upload.

## Repository and GitHub

- [x] README uses the adaptive dark/light mark and approved descriptor.
- [x] Repository description uses the approved descriptor.
- [x] Homepage points to the public Offing documentation.
- [x] Repository topics describe the product rather than inventing brand variants.
- [ ] Upload `brand/social-preview.png` as the repository social
      preview and inspect a shared link on both light and dark clients.
- [x] Issue templates use `Offing` and evidence-backed language consistently.

## Documentation

- [x] Site title and description match approved naming.
- [x] Header uses the adaptive half-sun mark.
- [x] Home page uses the approved tagline, descriptor, and supporting language.
- [x] Light and dark palettes use approved accessible pairs.
- [x] Brand guidance and asset terms are discoverable from public documentation.
- [x] The site remains static, dependency-light, and free of decorative raster
      downloads on documentation pages.

## npm

- [x] Package ID remains `offing`.
- [x] Description matches the approved product descriptor.
- [x] Homepage, repository, bugs, license, and relevant discovery keywords exist.
- [ ] Reconfirm packed contents and rendered npm README before each publish.

## GitHub Action and Marketplace

- [x] Action name contains `Offing` and identifies lifecycle intelligence.
- [x] Action description is local-first, evidence-backed, and function-specific.
- [x] Marketplace icon/color use the closest supported neutral treatment.
- [x] Marketplace logo sources exist in `brand/` (`mark-night.svg`, `mark-day.svg`).
- [ ] Preview marketplace metadata and images before creating or updating a
      listing.

## Agent Skill and future plugins

- [x] Agent Skill metadata names Offing and preserves trigger clarity.
- [x] Skill content states the local execution and evidence boundaries.
- [x] Reuse the approved name, descriptor, mark, and asset terms in every future
      plugin manifest and directory listing.
- [ ] Run host-specific discovery and context-cost evaluations before submission.

### Listing versions (reviewed 2026-10-29 against release `0.7.1`)

Record the version each public Skill or plugin surface shows after a release. The
current npm package, Action tag, and generated plugin pins are `0.7.1`.

- [x] [skills.sh](https://skills.sh/velella-sh/offing/offing)
      lists `velella-sh/offing@offing`. The page has no package
      version field; install resolves from the repository Skill on `main`, which
      matches the Skill shipped in `0.7.1`.
- [x] Claude repository marketplace
      (`.claude-plugin/marketplace.json` and `plugins/claude/`) publishes plugin
      version `0.7.1` and pins `@velella/offing@0.1.0`.
- [x] Codex repository marketplace (`plugins/codex/`) publishes plugin version
      `0.7.1` and pins `@velella/offing@0.1.0`. OpenAI's public plugin
      directory still has no Offing entry (submission tracked separately).

## Releases

- [ ] Use the approved mark or social preview for launch posts.
- [ ] Keep release notes factual; lead with lifecycle coverage and evidence.
- [ ] Confirm changelog, package metadata, Action metadata, and documentation agree.
- [ ] Verify every referenced asset exists in the tagged commit.
- [ ] Check all external links and render the README and documentation in light and
      dark modes.

## Asset audit

The canonical assets live in `brand/` (see its README for the file list and how to
rebuild them). The documentation copies under `docs/assets/brand/` (adaptive mark,
favicons) are the only intentional duplicates; they exist because the GitHub Pages
source is scoped to `docs/`. The README mark lives in `.github/assets/`. No legacy
logo or pre-brand social asset remains in the repository.
