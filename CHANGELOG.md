# Changelog

## 2026-06-05

### Changed
- **Group 3 rewritten from per-ticket to bulk** (`scripts/InventoryActions.gs`): instead of one `EntityId` query per ticket (8,000 tickets = 8,000 calls ≈ hours), a single paginated pull with the server-side `ActionTypeId=TICKET_USAGE` filter (~150 calls for ~70k usage actions ≈ minutes). Verified live: the filter works server-side, and bulk items include `Inventory` (scalar `InventoryItemId`/`LocationId`), `CreatedByUser`, and `Ticket` with a `Fields` projection. Rows are kept when `RelatedEntityId` matches a Group 2 ticket (already school-year-scoped); item name/number/category are joined from the InventoryItems catalog (`buildCatalogMap_()`) — **CategoryName and StockLocationId are now populated** (both were blank in the per-ticket version, which couldn't expand them either). Resumable via `ACTIONS_LOAD_PAGE` (replaces `TICKET_PROCESS_INDEX`; reset sites in `Menu.gs`/`Triggers.gs`/`DataOrchestrator.gs` updated). Instructions/README/CLAUDE.md updated, including correcting the 2026-05-18 note that `Ticket` is never returned (it is, in bulk mode).

### Added
- **School-year window validation** (`validateSchoolYearWindow()` in `scripts/Config.gs`, wired into `startInitialLoad()`): unparseable dates (e.g. `2027-06-31`) and inverted ranges now block the load with a clear message before the lock snapshots them; an all-future window prompts "continue anyway?". `finalizeTicketLoad_()` (`scripts/TicketData.gs`) now logs a WARNING instead of SUCCESS when 0 tickets matched, pointing at the Config dates. Found via live smoke test: a future-dated window loaded "successfully" with 0 rows and looked like a query failure.

### Fixed
- **"Range not found" error in Run Complete Setup** — `setupDashboardSheet()` used `getRange('B3:B3,D3:D3')`; `getRange()` does not accept comma-separated multi-range A1 notation. Replaced with `getRangeList(['B3','D3'])`. Latent since the initial scaffold; surfaced on the first end-to-end setup run.

### Changed
- **`setupPartsTrackerDashboard()` is now a destructive clean slate** (model-project behavior): every `setup*Sheet()` deletes and recreates its sheet via `deleteSheetIfExists()` instead of skipping existing ones. The confirm dialog now warns that data and credentials will be lost, and the operation is gated by `requireNoTriggers()`. `regenerateAnalyticsSheetsWithConfirm()` drops its redundant delete loop. Instructions sheet (menu reference, DateFilters restore steps) and README updated to match.
- **Config sheet QOL** (`setupConfigSheet()` in `scripts/Setup.gs`) — brought up to par with `iiq-tickets-to-sheets`: MODULE is now a dropdown (Ticketing/Facilities) with help text, SCHOOL_YEAR_START/END are pre-populated with the current June-based school year in YYYY-MM-DD (cells number-formatted to keep that display), API_BASE_URL ships a `https://your-district.incidentiq.com` placeholder, and keys are grouped under shaded `#` section headers (Required / School Year / Performance / Managed Automatically). Instructions sheet quick-start updated to match.

## 2026-06-04

### Added
- **Instructions sheet** (`setupInstructionsSheet()` in `scripts/Setup.gs`) — canonical in-sheet end-user documentation per the workspace Instructions Sheet Pattern, modeled on `iiq-labor-to-sheets`. Covers overview, quick start, the three-group load flow, sheet/menu references, automation, school-year locking, troubleshooting, Looker Studio / Power BI integration, tips, and support. Wired into `setupPartsTrackerDashboard()` and placed as the first tab via `reorderSheets_()`. README + CLAUDE.md sheet lists updated.
- `LICENSE` — MIT, matching the sibling `iiq-*-to-sheets` repos.
- `.clasp.json` — bound test deployment ("iiQ Parts to Sheets (Test)" sheet) so `npm run push` works out of the box for development.

### Changed
- `README.md` — rewrote the Data source section to describe the verified three-group load flow (catalog → tickets-with-parts via `InventoryUsedDate` facet → per-ticket inventory actions); the previous text described the abandoned single-endpoint approach. Linked `iiq-labor-to-sheets` to its published repo.

## 2026-05-18

### Changed
- **Reworked load architecture** based on live API verification against the demo tenant. The original `/inventory/actions/query` + `Fields:["Ticket"]` approach was found to be non-functional: the `ActionDate` facet is silently ignored, the body `Paging` block is overridden, and the `Ticket` field is never returned. New flow uses the tickets endpoint to scope which tickets we care about, then per-ticket inventory action pulls:
  - `scripts/TicketData.gs` rewritten as primary loader using `POST /v1.0/tickets` with `Filters:[{Facet:'InventoryUsedDate', Value:'daterange:...'}]`. Returns only tickets that consumed parts in the school year, with full ticket context inline. Adds `buildTicketContextMap()` helper for the parts pull.
  - `scripts/InventoryActions.gs` rewritten as a per-ticket loader. Iterates the Tickets sheet, calls `POST /v1.0/inventory/actions/query?$o=ActionDate desc` with `{EntityId:<TicketId>}` body. Filters client-side to `InventoryActionTypeId === d3ea78e4-...` (TICKET_USAGE) AND `Quantity < 0`. Denormalizes ticket context inline. Resumable via `TICKET_PROCESS_INDEX`.
  - `scripts/DataOrchestrator.gs` simplified to 3 groups: `INVENTORY_ITEMS → TICKETS_WITH_PARTS → INVENTORY_ACTIONS`.
  - `scripts/Menu.gs` — removed the "Re-enrich Ticket Context" item; updated `resetLoadStates()` to clear the new state keys.
  - `scripts/Triggers.gs` — daily refresh queues Groups 2 and 3 (catalog refresh stays manual).
  - `scripts/Setup.gs` — comment updated to reflect inline denorm.
- **Removed `scripts/Enrich.gs`** — no longer needed; ticket context is denormalized onto each `InventoryActions` row at write time using the in-memory context map.
- Updated `CLAUDE.md` with verified API findings, the new flow, and the corrected config-key list.

### Added
- Initial scaffold of `iiq-parts-to-sheets`. Pulls parts (inventory) usage and cost data from the Incident IQ API, mirroring the structure of `iiq-labor-to-sheets` so districts have a tickets + labor + parts trio of analytics sheets.
- `scripts/Config.gs`, `scripts/ApiClient.gs` — foundation layer (config, logging, locks, HTTP retry/backoff).
- `scripts/DataOrchestrator.gs` — 4-group load state machine: InventoryItems → InventoryActions → Tickets → Enrich.
- `scripts/InventoryActions.gs` — primary loader using `POST /v1.0/inventory/actions/query` with `Fields` projection expanding `Inventory.InventoryItem.Category`, `Inventory.Location`, `Ticket`, `CreatedByUser`.
- `scripts/TicketData.gs` — secondary loader, batch-fetches tickets referenced by inventory actions to add team/category context.
- `scripts/InventoryItems.gs` — catalog reference loader (`POST /v1.0/inventory/items/query`).
- `scripts/Enrich.gs` — denormalizes ticket-context columns (AssignedUser, AssignedTeam, TicketLocationName, IssueCategory, IssueType) onto `InventoryActions` rows. Resumable via `ENRICH_ROW_CURSOR`.
- `scripts/Setup.gs` — creates Config, DateFilters, InventoryActions (25 cols), Tickets (19 cols), InventoryItems (14 cols), and 6 default analytics sheets (Dashboard, ByCategory, ByItem, ByTeam, ByLocation, ByTicket, MonthlyTrend).
- `scripts/Menu.gs` — iiQ Data menu with Setup, Load Data, Troubleshooting submenus.
- `scripts/Triggers.gs` — 10-minute monitor trigger for resumable loads + daily 2 AM full refresh.
- README, CLAUDE.md, package.json, .gitignore, appsscript.json.
