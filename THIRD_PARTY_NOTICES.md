# Third-party notices and data provenance

## tariff-resolver core — MIT

This application bundles the pure dataset, origin, chapter-filter and duty-screening
core of [opsloft/tariff-resolver](https://github.com/opsloft/tariff-resolver), version
1.1.1, commit `3968b88125ec09653c4c7fad9ec0f0dd403260e4`, retrieved on 2026-11-23.
Copyright (c) 2026 Opsloft. Licensed under the MIT License; the complete copyright
and permission notice is preserved in `vendor/tariff-resolver/LICENSE`.

The upstream TypeScript core was converted to JavaScript by Node's type-stripping
utility with no semantic changes. This app adds Chinese navigation aliases, exact
code selection, pagination and a presentation adapter. The adapter carries the
nearest actual rate-parent's footnotes onto statistical suffixes that inherit that
rate, preserving the parent's code as provenance. Explicit full-heading ranges in
those notes are expanded for candidate screening; original note text is retained.
It does **not** use upstream
fixed-fee figures or expose candidate layers as a final combined duty. Upstream
historical status annotations are retained with their date and original source;
they do not establish current applicability.

## USITC Harmonized Tariff Schedule — official public data

The complete US HTS snapshot is downloaded directly from the US International
Trade Commission export endpoint, not scraped from a commercial tariff service:

- Export: <https://hts.usitc.gov/reststop/exportList?from=0101&to=9999&format=JSON&styles=false>
- Official browser and downloads: <https://hts.usitc.gov/>
- Official current-revision announcement: <https://www.usitc.gov/harmonized_tariff_information>
- Official API documentation: <https://www.usitc.gov/documents/hts/hts_external_user_guide.pdf>
- U.S. Government catalog record and public-domain designation:
  <https://catalog.data.gov/dataset/harmonized-tariff-schedule-of-the-united-states-2025>

The exact revision, release date, retrieval timestamp, row count, download URL and
SHA-256 digest of the downloaded response are recorded in `data/metadata.json`.
Run `npm run update-data` (Node 20+) to validate and replace both the server snapshot
and the offline bundle. Native fetch is used first; a system curl fallback is
available for machines with a corporate CA configuration. The Python-only fallback
is `python3 scripts/update-data.py`, followed by `node scripts/build-offline.mjs`.
Failed
downloads, missing chapters or an unverified official revision leave old data intact.
The app identifies the data as a snapshot and offers no historical rate selection.

The Chinese headings are manually written navigation aids, not official translated
classification determinations. The original English descriptions and duty text are
always retained. The application is not affiliated with USITC, CBP or any government.

## AD/CVD and regulatory scope

This application does not bundle an AD/CVD case database or a certification database.
It always returns `unknown` for those fields and points users to official resources:

- USITC FAQ: <https://www.usitc.gov/harmonized_tariff_information/frequently_asked_questions>
- U.S. Commerce AD/CVD search: <https://access.trade.gov/adcvd>
- U.S. Commerce scope explanation:
  <https://www.trade.gov/antidumping-and-countervailing-duty-frequently-asked-questions>

An HTS code is a screening aid. Case scope, origin, entry date, exclusions, rates,
stacking, collection status and other import requirements require separate checks.
