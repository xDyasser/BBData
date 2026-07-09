# Blood Bank Statistics

A self-contained web app for tracking daily blood-component activity
(Form-LAB-ARH-GEN-016) and analyzing it with graphs — **per year, per month,
per day, per ward/floor, and per component**. Built from the original
`Blood_Bank_Daily_Statistics` workbook.

## Running it

No server or build step needed. Just open **`index.html`** in a browser
(double-click it, or host the folder on any static web host / shared drive).

All libraries are bundled locally in `vendor/`, so it works fully offline.

## Data & storage

- Data lives in your browser (localStorage) on the device you use — there is
  **no login and no server**.
- The app ships pre-loaded with all **30 months** from the original workbook
  (Jan 2024 – Jul 2026).
- **Back up or move your data** from the *Manage / Import* tab:
  - **Export JSON** — a full backup of everything.
  - **Export Excel** — a per-month report workbook.
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

## Notes

- **Totals are always computed from the daily cells** (the source of truth).
  In the original workbook, 17 rows had a stored monthly total that disagreed
  with the sum of its own daily cells (mostly Platelets, where the stored total
  was half the daily sum); the app recomputes these consistently.
- Month/year for each original sheet was taken from the **sheet tab name**, not
  the in-cell header text, which contained stale copy-pasted dates.

## Project layout

```
index.html       app shell
styles.css       styling (light + dark, follows OS theme)
app.js           all logic: aggregation, charts, entry grid, import/export
data-seed.js     bundled historical data (generated from the workbook)
vendor/          Chart.js + SheetJS (local copies)
tools/           parse_workbook.py + seed.json (how the seed was generated)
```
