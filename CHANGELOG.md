# Changelog

## 2026-06-04

### Added
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
