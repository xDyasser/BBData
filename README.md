# Blood Bank Statistics

A self-contained web app for tracking daily blood-component activity
(Form-LAB-ARH-GEN-016) and analyzing it with graphs — **per year, per month,
per day, per ward/floor, and per component**. Built from the original
`Blood_Bank_Daily_Statistics` workbook.

## Running it

No server or build step needed. Two equivalent ways to run:

- **`BloodBankStatistics.html`** — a **single self-contained file** with
  everything (styles, code, data, and libraries) inlined. Just double-click it,
  or email/copy it anywhere — nothing else required.
- **`index.html`** — the same app split into separate files (`styles.css`,
  `app.js`, `data-seed.js`, `vendor/`), which is easier to edit.

Both work fully offline. If you edit the split files, regenerate the single
file with `python3 tools/build_single.py`.

## Data & storage

- Data lives in your browser (localStorage) on the device you use — there is
  **no login and no server**.
- The app ships pre-loaded with all **30 months** from the original workbook
  (Jan 2024 – Jul 2026).
- **Export / reporting** from the *Manage / Import* tab:
  - **Export report (graphs + analysis)** — a polished, printable report that
    opens in a new tab with KPIs, auto-generated key findings, four graphs
    (yearly issuance, component share, by-ward, monthly trend) and summary
    tables. Use its **Print / Save as PDF** button for a shareable PDF.
  - **Export Excel (styled + charts)** — a professionally formatted workbook
    with **Summary**, **By Year**, **By Ward**, and **By Month** sheets:
    colored header bands, borders, frozen panes, live SUM formulas, and
    **native Excel charts** (pie, clustered bar, stacked bar, line) that open
    as real, editable charts inside Excel. See "How the styled Excel works".
  - **Export Excel (monthly forms)** — the raw per-month daily forms, one
    sheet per month (plain data, no styling).
  - **Export JSON** — a full backup of everything.
  - **Import JSON** — restore a backup (replaces current data).
  - **Import Excel workbook** — read months from a workbook shaped like the
    original form (detects month/year from each sheet tab name).

## Using it

- **Dashboard** — choose a scope (by year / by month / by day) and filter by
  component and ward/floor. Four charts update live: trend over time, breakdown
  by component, breakdown by ward, and activity by section.
- **Data Entry** — pick a month + section, type daily counts into the grid;
  row/column/grand totals recalculate automatically and save instantly.
- **Manage / Import** — add new (or old) months, delete months, import/export,
  or restore the bundled data.

## Sections tracked (per the form)

Issuing PRBC / FFP / CRYO / Platelets (by ward), Received Cross-matched
(by ward), Returned from Ward, Returned ARH→ASH, and Daily inventory from ASH
(each by component).

**Transfusion Lab tests** — a second monthly form (23 tests such as ABO&RhD,
DIRECT COOMBS, X-MATCHING, PANEL, TITRATION, …) tracked per day. Choose
"Transfusion Lab tests" in the Data Entry section dropdown. Importing a
Transfusion Lab workbook merges its data into the matching month without
touching the blood-bank data. Test counts appear in the printable report and
the monthly Excel forms.

**Daily staff signature** — one free-text signature per day (who recorded that
day), entered via the "Daily staff signature" section and printed as a row on
the monthly Excel forms.

## Notes

- **Totals are always computed from the daily cells** (the source of truth).
  In the original workbook, 17 rows had a stored monthly total that disagreed
  with the sum of its own daily cells (mostly Platelets, where the stored total
  was half the daily sum); the app recomputes these consistently.
- Month/year for each original sheet was taken from the **sheet tab name**, not
  the in-cell header text, which contained stale copy-pasted dates.

## How the styled Excel works

The free SheetJS build can't write cell styles or charts, so the styled export
uses the same technique as a reference app we studied: **one nicely-formatted
Excel template is pre-built (with openpyxl) and embedded in the page as base64**
(`template-embed.js`). At export time the app opens that template as a zip
(JSZip), **injects the current values straight into the worksheet XML** —
leaving all styling, formulas, and chart definitions untouched — patches the
chart data ranges to the live number of years/months, drops `calcChain.xml` so
Excel recalculates, and re-zips. The result is a genuinely styled workbook with
real charts, produced entirely in the browser with no server.

To change the template's look or charts, edit `tools/build_template.py`, run it
(`python3 tools/build_template.py`), then rebuild the single file
(`python3 tools/build_single.py`).

## Project layout

```
index.html         app shell
styles.css         styling (light + dark, follows OS theme)
app.js             all logic: aggregation, charts, entry grid, import/export
data-seed.js       bundled historical data (generated from the workbook)
template-embed.js  base64 styled Excel template (generated by build_template.py)
vendor/            Chart.js + SheetJS + JSZip (local copies)
tools/             parse_workbook.py, build_template.py, build_single.py
```
