# INPUT Tools – SEO Automation Engine V9

Google Apps Script automation for standardizing product SEO names and managing upload dates in Google Sheets, with batch processing, progress checkpoints, and automatic recovery.

## Overview

This project processes product information in the `INPUT` sheet, using naming rules from `SEO NAME RULE`. It is written in **JavaScript for Google Apps Script**, not Python or a standalone web application.

Core goals:
- Convert product nicknames into standardized SEO names.
- Fill missing upload dates without overwriting existing dates.
- Process selected rows or scan the sheet in batches.
- Resume interrupted jobs using saved checkpoints and time-driven triggers.
- Track progress and errors in a processing-status dialog.

## Required Google Sheets

### `INPUT`

The script identifies columns by header names in row 1, rather than fixed column letters:

| Header | Purpose |
| --- | --- |
| `Nickname không để tên hãng` | Original product nickname |
| `full SEO` | Standardized SEO product name |
| `NGÀY UPLOAD` | Upload date |
| `Request TECH` | Technical request status |
| `NGÀY RQ` | Request date |
| `Final Check` | Final check status |
| `Checked time` | Final check date/time |

### `SEO NAME RULE`

Rules are read from columns A–C starting at row 2:

| Column A | Column B | Column C |
| --- | --- | --- |
| Key | Replacement name | Rule type: `exact` or `prefix` |

Example mappings (illustrative; configure actual mappings in the sheet):

| Key | Replacement name | Type |
| --- | --- | --- |
| `AJ` | `Air Jordan` | `prefix` |
| `DM` | `Dr. Martens` | `prefix` |

The engine supports examples such as `AJ4` → `Air Jordan 4`, while avoiding false replacements of a standalone `J` in names such as `J Balvin`.

## Menu: INPUT Tools

The `onOpen()` function creates the menu when the spreadsheet is opened.

| Menu action | Behavior |
| --- | --- |
| Fill blanks: SEO + Date | Initial full scan, then pending/new rows |
| Update selected: SEO + Date | Queue a selected-range SEO/date job |
| SEO processing status | Show selected-job and full-scan progress |
| Reset + scan SEO from row 2 | Reset SEO indexing and rescan |
| Reload SEO rules | Clear rule cache and schedule reprocessing |
| Fill missing upload dates | Fill upload dates for eligible rows |
| Brand actions | Delegated to a separate Brand module |
| Request TECH / Final Check actions | Delegated to separate date-status functions |

## How processing works

1. Read product nicknames and compiled SEO rules.
2. Apply `prefix` and `exact` replacements to construct `full SEO`.
3. Skip rows with no nickname.
4. Preserve an existing upload date; fill it only when blank.
5. Record checkpoints and continue unfinished batches through time-driven triggers.
6. Show job state, last successful row, next row, and errors.

### Batch configuration

Selected values in `CONFIG`:

| Setting | Value |
| --- | --- |
| `SEO_BATCH_SIZE` | 40 rows |
| `SEO_MAX_BATCHES_PER_RUN` | 4 |
| `SEO_SAFE_RUNTIME_MS` | 25,000 ms |
| `SELECTED_SEO_BATCH_SIZE` | 20 rows |
| `SELECTED_SEO_MAX_BATCHES_PER_RUN` | 1 |
| `SEO_CONTINUE_AFTER_MS` | 60,000 ms |
| `SEO_WATCHDOG_AFTER_MS` | 90,000 ms |
| `SEO_CACHE_SECONDS` | 21,600 seconds (6 hours) |

These are configured delays, not guarantees of exact execution time.

## Installation

1. Open the target Google Sheet and select **Extensions → Apps Script**.
2. Add the SEO engine source as a `.gs` script file.
3. Verify that the `INPUT` and `SEO NAME RULE` sheets and the required headers exist.
4. Add the separate Brand and Date Status modules if their menu items are needed.
5. Ensure that only the intended script defines global handlers such as `onOpen` and `onEdit`.
6. Save, authorize required permissions, and reload the spreadsheet.
7. Test on a copy of the sheet before running a full scan on production data.

## Dependencies and integration notes

This file's `onOpen()` menu references functions **not defined in this file**, including:

- `updateSelectedBrandRows`
- `showBrandProcessingStatus`
- `resetAndScanBrandFromStart`
- `dateStatusReloadRqOnly`
- `dateStatusReloadCheckOnly`
- `dateStatusUpdateSelectedRqOnly`
- `dateStatusUpdateSelectedCheckOnly`
- `reloadRequestTechCheckedTime`

These need to be supplied by other `.gs` files in the same Apps Script project. The SEO `onEdit(e)` explicitly delegates Request TECH and Final Check event handling to the separate `dateStatusOnEdit_` installable trigger.

**Caution:** Do not assume that the entire menu is operational when only this one file has been installed. Some date-related helper functions remain in the source, but the menu routes to external handlers.

## Troubleshooting

- **Missing header error:** Check the exact header names in row 1 of `INPUT`.
- **SEO does not update:** Check the rule sheet, pending jobs, and `SEO processing status`.
- **Job appears stuck:** Inspect the last successful row, cursor, continuation trigger, and watchdog state.
- **Brand or Date menu action fails:** Confirm that the companion module defines the referenced function.
- **Long-running scan:** The engine intentionally processes batches and may continue asynchronously.

## Source version

The provided source identifies itself as **SEO RULE / FULL SEO ENGINE – V9**, with watchdog no-spam, spreadsheet binding for triggers, and regex boundary fixes.

## Safety

Back up the spreadsheet and Apps Script project before changes. Avoid resetting jobs while other work is in progress. The current README documents the supplied code; it does not certify that every runtime path has been tested in Google Apps Script.
