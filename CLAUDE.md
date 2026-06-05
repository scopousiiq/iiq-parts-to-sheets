# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project Overview

Google Apps Script + Google Sheets solution that pulls **parts (inventory)** usage and cost data from the Incident IQ API. Companion to `iiq-tickets-to-sheets` and `iiq-labor-to-sheets`, completing the tickets + labor + parts trio.

The primary entity is the **InventoryAction** — a stock-change event. For ticket-linked actions, the `RelatedEntityId` and the expanded `Ticket` field provide the ticket context.

## Critical API Notes

**Always use `/api/v1.0/inventory/*` endpoints, NOT `/api/v1.0/parts/*`.** See workspace memory `feedback_inventory_not_parts_endpoint.md`.

**`/inventory/actions/query` is heavily limited at the API level** — verified live against demo tenant on 2026-05-18:
- The `Filters` array silently ignores all unknown facets (including `ActionDate`). Only the 6 typed top-level Guid filters work: `ActionTypeId`, `InventoryItemId`, `InventoryId`, `LocationId`, **`EntityId`** (TicketId), `InventoryActionGroupKey`.
- The body `Paging` block is ignored — must pass `$p`/`$s`/`$o` on the query string.
- The expanded `Ticket` field is never returned, even with `Fields: ["Ticket"]` requested.

**The load is driven from the tickets endpoint instead.** `POST /v1.0/tickets` supports `Facet: 'InventoryUsedDate'` which generates this SQL subquery:
```sql
SELECT [ia].RelatedEntityId FROM dbo.InventoryActions AS [ia]
WHERE ia.Quantity < 0 AND ia.InventoryActionTypeId = '{TICKET_USAGE}'
  AND ia.RelatedEntityTypeId = '{Tickets.EntityTypeId}' AND ({dateExpression})
```
This scopes the result to exactly the tickets we need. Demo verification: 27,229 total tickets → 2,444 with parts in 2020-2026 range, 0 in a 1-day 2020 range. Constant: `TICKET_USAGE = d3ea78e4-707a-ec11-ba97-88665a256e9d`.

Related ticket facets that work: `InventoryUsedQuantity`, `InventoryUsedCost`, `InventoryUsedTotalCost`, `InventoryItemCategory`, `InventoryItemName`, `InventoryItemNumber`.

## Development Environment

Google Apps Script project — no local build/test framework. Files in `scripts/` are deployed manually to the Apps Script editor (or via `clasp push`).

- **Testing:** Run functions directly from the Apps Script editor (`testApiConnection()`, `startInitialLoad()`, `executeNextLoad()`).
- **Style:** 2-space indentation.

## Architecture

### Script files (`scripts/`)

| File | Role |
|------|------|
| `Config.gs` | Config read/write, type coercion, logging, locks, school-year locking |
| `ApiClient.gs` | HTTP client with retry/backoff |
| `DataOrchestrator.gs` | Load state machine (3 groups), `executeNextLoadInternal_()`, `startInitialLoad()` |
| `TicketData.gs` | Primary loader — `POST /v1.0/tickets` with `Facet:'InventoryUsedDate'` scoping; writes to `Tickets` sheet. Also exposes `buildTicketContextMap()` for inline denorm. |
| `InventoryActions.gs` | Per-ticket loader — iterates Tickets rows, `POST /v1.0/inventory/actions/query?...&EntityId=<TicketId>`, filters to TICKET_USAGE consumption events, denormalizes ticket context inline |
| `InventoryItems.gs` | Catalog reference loader (`POST /v1.0/inventory/items/query`) |
| `Setup.gs` | Sheet creation, headers, formulas |
| `Menu.gs` | `onOpen()` menu (iiQ Data → Setup, Load Data, Troubleshooting) |
| `Triggers.gs` | Time-driven monitor (10 min) + daily refresh (2 AM) |
| `appsscript.json` | Manifest |

### Load flow

Three sequential groups; each can be paused/resumed via the 10-minute monitor trigger:

1. **Group 1 — `INVENTORY_ITEMS`**: Pulls the parts catalog (small, one-shot).
2. **Group 2 — `TICKETS_WITH_PARTS`**: Paginated `POST /v1.0/tickets` with `Filters: [{Facet:'InventoryUsedDate', Value:'daterange:...'}]`. Sorted `TicketCreatedDate asc` for stable pagination. Returns only tickets that had parts consumed in the school-year window, with full context (AssignedToUser, AssignedToTeam, Location, Issue, WorkflowStep). Writes to `Tickets` sheet.
3. **Group 3 — `INVENTORY_ACTIONS`**: Iterates the `Tickets` sheet row by row. For each TicketId, calls `POST /v1.0/inventory/actions/query?$o=ActionDate desc&$p=N&$s=500` with `{EntityId: <TicketId>}` in the body. Filters client-side to `InventoryActionTypeId === TICKET_USAGE` AND `Quantity < 0` (the real consumption events; reversal/return entries are excluded). Denormalizes ticket context inline from `buildTicketContextMap()` (built once at the start of the group). Appends to `InventoryActions` sheet in 200-row batches. Resumable via `TICKET_PROCESS_INDEX`.

All state lives in `Config` so the load is resumable across the 6-minute Apps Script execution limit.

### Google Sheets structure

- **Instructions** — in-sheet end-user documentation (canonical Instructions Sheet Pattern; first tab)
- **Config** — key-value settings
- **DateFilters** — start/end of reporting window (defaults to school-year range from Config)
- **InventoryActions** — primary data (25 columns; see layout below)
- **Tickets** — ticket context for tickets with parts usage (19 columns)
- **InventoryItems** — catalog reference (14 columns)
- **Dashboard, ByCategory, ByItem, ByTeam, ByLocation, ByTicket, MonthlyTrend** — analytics (formula-driven)
- **Logs** — operation log (auto-pruned to 1000 rows)

### IncidentIQ API

- Auth: Bearer token + SiteId header + ProductId header + `Client: ApiClient`
- Base URL stored without `/api` suffix; `normalizeBaseUrl()` appends it
- Inventory paging: `Paging: { PageIndex, PageSize, SortField, SortDirection }` (note: distinct from the `$p`/`$s`/`$o` query-string scheme used by `/tickets`)
- Filters: `Filters: [{ Facet, Ids?, Values?, Value? }]`
- Rate limiting: `THROTTLE_MS` (default 1000ms) between calls, plus exponential backoff on 429/5xx

## InventoryActions Column Layout (25 columns)

| Col | Letter | Header | Source |
|-----|--------|--------|--------|
| 1 | A | InventoryActionId | `item.InventoryActionId` |
| 2 | B | ActionDate | `item.ActionDate` |
| 3 | C | ActionTypeId | `item.InventoryActionTypeId` |
| 4 | D | Quantity | `item.Quantity` (signed) |
| 5 | E | QuantityAbs | `ABS(Quantity)` |
| 6 | F | UnitCost | `item.UnitCost` |
| 7 | G | TotalCost | `QuantityAbs × UnitCost` |
| 8 | H | ItemId | `Inventory.InventoryItem.InventoryItemId` |
| 9 | I | ItemName | `Inventory.InventoryItem.Name` |
| 10 | J | ItemNumber | `Inventory.InventoryItem.ItemNumber` |
| 11 | K | CategoryName | `Inventory.InventoryItem.Category.Name` |
| 12 | L | StockLocationId | `Inventory.Location.LocationId` |
| 13 | M | StockLocationName | `Inventory.Location.Name` |
| 14 | N | TicketId | `Ticket.TicketId` |
| 15 | O | TicketNumber | `Ticket.TicketNumber` |
| 16 | P | TicketSubject | `Ticket.Subject` |
| 17 | Q | PerformedByUserId | `CreatedByUser.UserId` |
| 18 | R | PerformedByUser | `CreatedByUser.Name` |
| 19 | S | Description | `item.Description` |
| 20 | T | CreatedDate | `item.CreatedDate` |
| 21 | U | AssignedUser | denormalized inline from Tickets sheet |
| 22 | V | AssignedTeam | denormalized inline from Tickets sheet |
| 23 | W | TicketLocationName | denormalized inline from Tickets sheet |
| 24 | X | IssueCategoryName | denormalized inline from Tickets sheet |
| 25 | Y | IssueTypeName | denormalized inline from Tickets sheet |

## Tickets Column Layout (19 columns)

| Col | Letter | Header |
|-----|--------|--------|
| 1 | A | TicketId |
| 2 | B | TicketNumber |
| 3 | C | Subject |
| 4 | D | CreatedDate |
| 5 | E | ClosedDate |
| 6 | F | AssignedUser |
| 7 | G | AssignedUserEmail |
| 8 | H | AssignedTeam |
| 9 | I | Location |
| 10 | J | Requester |
| 11 | K | Status |
| 12 | L | IsClosed |
| 13 | M | AssignedUserId |
| 14 | N | AssignedTeamId |
| 15 | O | LocationId |
| 16 | P | IssueCategoryId |
| 17 | Q | IssueCategoryName |
| 18 | R | IssueTypeId |
| 19 | S | IssueTypeName |

## Config Key Reference

### Required

| Key | Example | Notes |
|-----|---------|-------|
| `API_BASE_URL` | `https://district.incidentiq.com` | No `/api` suffix |
| `BEARER_TOKEN` | JWT | Auth token |
| `SITE_ID` | UUID | Site identifier |
| `MODULE` | `Ticketing` | `Ticketing` or `Facilities` |
| `SCHOOL_YEAR_START` | Date | Reporting period start |
| `SCHOOL_YEAR_END` | Date | Reporting period end |

### Optional (have defaults)

| Key | Default |
|-----|---------|
| `PAGE_SIZE` | `500` |
| `TICKET_BATCH_SIZE` | `100` |
| `THROTTLE_MS` | `1000` |

### Auto-managed

| Key | Purpose |
|-----|---------|
| `LOAD_STATE_*` | Per-group load states |
| `TICKET_LOAD_PAGE` | Current page in the tickets-with-parts pull (Group 2) |
| `TICKET_LOAD_FIRST_TOTAL_ROWS` / `TICKET_LOAD_EXPECTED_COUNT` | TotalRows tracking for drift detection |
| `TICKET_PROCESS_INDEX` | Current ticket index in the per-ticket parts pull (Group 3) |
| `SCHOOL_YEAR_LOCKED*` | Locked-config snapshot |
| `LAST_SYNC` | Last successful sync timestamp |

## Key Patterns

- **Config as key-value store** — `getConfig(key)` / `setConfig(key, value)`. All values stored as strings to avoid Sheets auto-format issues.
- **Type coercion** — `getStringValue()`, `getIntValue()`, `getBoolValue()` handle Sheets' unpredictable return types.
- **Config caching** — `cacheConfigRowPositions()` + `writeConfigValueDirect()` for tight loading loops.
- **LockService concurrency** — `acquireScriptLock()` (menu items) vs `tryAcquireScriptLock()` (triggers).
- **Destructive op safety** — `requireNoTriggers()` gates full reload and Run Complete Setup.
- **Clean-slate setup** — `setupPartsTrackerDashboard()` deletes and recreates ALL sheets (model-project behavior); every `setup*Sheet()` starts with `deleteSheetIfExists()`. Never call a `setup*Sheet()` from a loader — it destroys data.
- **Load state machine** — 4 ordered groups, each type has `LOAD_STATE_<TYPE>` in Config.
- **Stable pagination** — All inventory queries sort `CreatedDate Ascending` per workspace memory rule.
- **Resumable** — All paginators check `MAX_RUNTIME_MS = 5.5 min` and save cursor to Config before yielding.

## Changelog

After every code change (new features, bug fixes, refactors), update `CHANGELOG.md`. Follow the format established in that file:
- Group entries under a date heading (`## YYYY-MM-DD`)
- Use `### Added`, `### Changed`, `### Fixed` sub-headings as appropriate
- Concise bullets describing the change + affected files
