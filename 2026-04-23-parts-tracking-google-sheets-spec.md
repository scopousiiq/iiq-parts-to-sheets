# IncidentIQ Parts Tracking & Inventory Reports — Google Sheets Solution

> **Purpose**: Specification for building a Google Sheets + Apps Script solution that pulls parts usage, parts inventory, and parts cost data from IncidentIQ's API. Produces rollup reports by part, supplier, team, agent, location, and issue type with flexible date range filters.
>
> **Created**: 2026-04-23
> **For**: District parts consumption and spend reporting
> **Model projects**: `iiq-tickets-to-sheets`, `iiq-labor-to-sheets`

---

## Executive Summary

Build a Google Sheets + Apps Script solution that extracts **parts usage events** (each consumption of a part against a ticket) and the **parts catalog** (current inventory on hand) from IncidentIQ. Produce formula-driven rollup reports answering:

- **Which parts are we consuming most?** (by quantity and by cost)
- **Where is our parts spend going?** (by supplier, by team, by agent, by location)
- **What kinds of issues consume parts?** (by issue category / issue type)
- **Which tickets are the most expensive?** (top tickets by parts cost)
- **How is spend trending?** (monthly, by school year)
- **What's running low?** (inventory on hand vs. usage rate)
- **What's on purchase orders?** (PO-level spend rollup)

---

## Problem Statement

Districts using IncidentIQ's Parts/Inventory module need:

1. **Spend visibility** — total parts cost by team, building, technician, issue category
2. **Consumption patterns** — which parts burn through stock fastest
3. **Inventory warnings** — parts at or below reorder threshold
4. **Ticket-level part cost** — what parts are being used on which tickets, with PO linkage
5. **Trend reporting** — monthly and annual spend trends, filterable by time period

**Current limitations in IncidentIQ:**
- No built-in rollup reports by team / location / issue category for parts spend
- No inventory-over-time trend view (`QuantityOnHand` is a point-in-time value only)
- Parts usage is viewable per-ticket but not aggregated cross-ticket

**Solution:** Extract via API and aggregate in Google Sheets with formula-driven rollups.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Google Sheets Workbook                       │
├─────────────────────────────────────────────────────────────────┤
│  📋 Instructions    │ In-sheet setup/user guide                 │
│  📋 Config          │ API credentials, school year, load state  │
│  📋 DateFilters     │ SWITCH-driven date range selection        │
│  📊 PartsUsage      │ Primary data: one row per part-on-ticket  │
│  📊 PartsCatalog    │ Current parts reference + QuantityOnHand  │
│  📊 PartSuppliers   │ Supplier reference                        │
│  📊 Teams           │ Team roster                               │
│  📊 Users           │ User → Team/Location mapping              │
│  📈 ByPart          │ Rollup: qty, cost, ticket count per part  │
│  📈 BySupplier      │ Rollup: spend per supplier                │
│  📈 ByTeam          │ Rollup: spend per team                    │
│  📈 ByAgent         │ Rollup: spend per assigned agent          │
│  📈 ByLocation      │ Rollup: spend per building / location     │
│  📈 ByIssueCategory │ Rollup: spend per issue category          │
│  📈 ByIssueType     │ Rollup: spend per issue type              │
│  📈 ByPurchaseOrder │ Rollup: spend per PO                      │
│  📈 TopTickets      │ Tickets with highest parts cost           │
│  📈 MonthlySpend    │ Trend: spend by month                     │
│  📈 LowStock        │ Parts below reorder threshold             │
│  📈 InventoryValue  │ Catalog value (QtyOnHand × CostEach)      │
│  🎛️ Dashboard       │ KPI cards + charts                        │
│  🗂️ Logs            │ Operation log (auto-trimmed)              │
│  🗂️ PartsUsageIndex │ Hidden: TicketActivityPartId → row        │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Apps Script
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    IncidentIQ API                               │
├─────────────────────────────────────────────────────────────────┤
│  POST /api/v1.0/parts/usage          → Parts-on-tickets events  │
│  GET  /api/v1.0/parts                → Parts catalog + QtyOnHand│
│  GET  /api/v1.0/parts/suppliers      → Supplier reference       │
│  GET  /api/v1.0/teams                → Team roster              │
│  GET  /api/v1.0/teams/{id}/members   → Team → user mapping      │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Reference

### Authentication (same as other iiQ projects)

```
Authorization: Bearer <JWT_TOKEN>
SiteId:        <site-uuid>
ProductId:     <module-product-uuid>
Client:        ApiClient
Content-Type:  application/json
```

### Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1.0/parts/usage` | POST | **Primary**: Part usage events (extends ticket with part fields) |
| `/api/v1.0/parts` | GET | Parts catalog with `QuantityOnHand` |
| `/api/v1.0/parts/{PartId}` | GET | Single part detail |
| `/api/v1.0/parts/suppliers` | GET | Supplier reference |
| `/api/v1.0/parts/suppliers/{PartSupplierId}` | GET | Single supplier detail |
| `/api/v1.0/teams` | GET | Team list |
| `/api/v1.0/teams/{teamId}/members` | GET | Team members for user lookup |

### Pagination

All list endpoints support:
- `$p` — page index (0-based)
- `$s` — page size (default 100 for parts endpoints; use 2000 for bulk as with labor project)
- `$o` — sort order (**required for stable pagination**; see API Rules below)

### `POST /api/v1.0/parts/usage` — Primary Data Source

Returns `PartUsage` records — each record **extends `Ticket`** with part-specific activity fields.

**Request body** uses the standard `GetTicketsRequest` schema (same as labor project):

```json
POST /api/v1.0/parts/usage?$p=0&$s=2000&$o=ActivityDate%20asc

{
  "ProductId": "88df910c-91aa-e711-80c2-0004ffa00010",
  "Filters": [
    {
      "Facet": "createddate",
      "Value": "date>=07/01/2025",
      "Negative": false,
      "GroupIndex": 0
    },
    {
      "Facet": "createddate",
      "Value": "date<=06/30/2026",
      "Negative": false,
      "GroupIndex": 0
    }
  ],
  "FilterByProduct": true,
  "IncludeDeleted": false
}
```

**Response** (per-item shape, abridged — see `PartUsage` schema for full list):

```json
{
  "ActivityDate": "2026-03-15T10:30:00Z",
  "TicketActivityPartId": "uuid",
  "TicketActivityId": "uuid",
  "PartId": "uuid",
  "PartName": "iPad 9th Gen Replacement Screen",
  "SupplierName": "Amazon Business",
  "PartSupplierId": "uuid",
  "Qty": 1,
  "CostEach": 89.00,
  "TotalCost": 89.00,
  "Notes": "Screen replacement for 4th grade device",
  "PurchaseOrderId": "uuid",
  "PoNumber": "PO-2026-0142",
  "PoIsApproved": true,
  "PoIsClosed": false,
  "PoClosedDate": null,
  "PoBudget": 5000.00,
  "PoNotes": null,
  "TotalEffort": 15,
  "...": "plus all Ticket fields (TicketId, TicketNumber, CreatedDate, ClosedDate, Subject, AssignedToUser, AssignedToTeam, Location, For, WorkflowStep, IssueCategory, IssueType, ResolutionAction, IsClosed)"
}
```

**Response envelope:**
```json
{
  "Paging": { "PageIndex": 0, "PageSize": 2000, "PageCount": 12, "TotalRows": 23456 },
  "Items": [ /* PartUsage records */ ]
}
```

### `GET /api/v1.0/parts` — Catalog

Returns paginated parts catalog. Each `Part` record:

| Field | Type | Notes |
|-------|------|-------|
| `PartId` | uuid | Primary key |
| `Name` | string | Display name |
| `StandardCostEach` | number | Standard cost/unit |
| `StandardSupplierId` | uuid | Default supplier |
| `StandardSupplier` | object | Expanded supplier (if present) |
| `QuantityOnHand` | integer | **Current inventory on hand** |
| `CreatedDate` | date-time | |
| `ModifiedDate` | date-time | |

Use `$o=Name%20asc` for stable pagination during bulk load.

### `GET /api/v1.0/parts/suppliers` — Supplier Reference

Each `PartSupplier` record:

| Field | Type | Notes |
|-------|------|-------|
| `PartSupplierId` | uuid | Primary key |
| `Name` | string | Supplier display name |
| `Address` | object | Optional address (AddressId, expanded Address) |

### Filter Facets for `/parts/usage`

Because `PartUsage` extends `Ticket`, the same filter facets used in the labor project apply:

| Facet | Type | Use |
|-------|------|-----|
| `createddate` | Date | Ticket creation date |
| `modifieddate` | Date | Last modified |
| `closeddate` | Date | Close date |
| `isclosed` | Boolean | Closed/open filter |
| `agent` | UUID | Filter by assigned agent |
| `team` | UUID | Filter by assigned team |
| `location` | UUID | Filter by ticket location |

Parts-module scoping may additionally require a `totalpartscost > 0` filter or filtering by `Items[].PartId <> null` after load — **to be validated during Phase 1 smoke testing**. The baseline query returns all tickets that have at least one part activity.

### API Rules (from workspace memory)

- **Always include `$o`** for paginated calls. Bulk load: `$o=ActivityDate%20asc` (parts/usage) or `$o=CreatedDate%20asc` (generic). Incremental: `$o=ModifiedDate%20asc`.
- Unsorted pagination is unreliable — records can shift between pages during multi-hour pulls.

---

## Google Sheets Structure

### Sheet 1: `Instructions`

Comprehensive in-spreadsheet user guide. **Required section list** (per `CANONICAL_PATTERNS.md`):

1. Overview — what this sheet does, data flow diagram
2. Initial Setup — numbered steps with exact menu paths (`Menu: iiQ Parts > Setup > ...`)
3. Automated Triggers — table of triggers with schedule and purpose
4. Sheets Reference — every data and analytics sheet with column descriptions and what question it answers
5. Menu Reference — complete menu tree
6. Troubleshooting — API errors, stuck loads, formula errors, trigger issues, concurrency
7. Dashboard Integration — Looker Studio + Power BI connection steps
8. Support — contact info, last-updated timestamp

Formatting: 800px single-column, blue title + section headers (`#1a73e8`), gray dividers (`#dadce0`), frozen first row, blue tab color.

### Sheet 2: `Config`

Key-value settings. All values stored as strings to prevent Sheets auto-formatting.

**Required (user provides):**

| Key | Example | Notes |
|-----|---------|-------|
| `API_BASE_URL` | `https://district.incidentiq.com` | No `/api` suffix |
| `BEARER_TOKEN` | JWT | Auth token |
| `SITE_ID` | uuid | Site identifier |
| `MODULE` | `Ticketing` or `Facilities` | Drives `ProductId` selection |
| `SCHOOL_YEAR_START` | `2025-07-01` | School year start |
| `SCHOOL_YEAR_END` | `2026-06-30` | School year end |

**Optional (have defaults):**

| Key | Default | Notes |
|-----|---------|-------|
| `PAGE_SIZE` | `'2000'` | Records per API call |
| `THROTTLE_MS` | `'1000'` | Delay between calls |
| `LOW_STOCK_THRESHOLD` | `'5'` | Default reorder threshold if not per-part |
| `OPEN_REFRESH_DAYS` | `'14'` | Days of recent usage to refresh nightly |

**Auto-managed (set by scripts):**

| Key | Purpose |
|-----|---------|
| `LOAD_STATE_*` | Per-type load states (`idle`/`pending`/`in_progress`/`complete`/`error`) for `PARTS_CATALOG`, `SUPPLIERS`, `TEAMS`, `USERS`, `PARTS_USAGE`, `PARTS_USAGE_RECONCILE` |
| `PARTS_USAGE_LOAD_PAGE` | Current usage pagination page |
| `PARTS_USAGE_TOTAL_PAGES` | Total usage pages |
| `PARTS_USAGE_EXPECTED_COUNT` | `Paging.TotalRows` snapshot (validation baseline) |
| `PARTS_USAGE_FIRST_TOTAL_ROWS` | First-observed TotalRows (drift detection) |
| `PARTS_USAGE_TOTAL_ROWS_DRIFT` | Delta between first and last TotalRows if dataset changed mid-load |
| `PARTS_CATALOG_LAST_FETCH` | Last catalog sync timestamp |
| `SCHOOL_YEAR_LOCKED` | `TRUE`/`FALSE` — locked once loading begins |
| `SCHOOL_YEAR_LOCKED_START/END` | Locked boundary values |
| `PAGE_SIZE_LOCKED` | Locked page size |
| `MODULE_LOCKED` | Locked module selection |
| `LAST_SYNC` | Last successful sync timestamp |

**School year locking pattern** (copy from labor project): once loading begins, `SCHOOL_YEAR_START/END`, `PAGE_SIZE`, and `MODULE` are locked in Config and cell-protected. A full reload is required to change them.

### Sheet 3: `DateFilters`

Exactly the same pattern as `iiq-labor-to-sheets` — SWITCH-based formulas for date range selection with dropdown in B1 and computed start/end dates in B2/B3. Options:

- This Week / Last Week
- This Month / Last Month
- This Quarter / Last Quarter
- This Calendar Year / Last Calendar Year
- This School Year / Last School Year
- Manual (user-entered in B2/B3)

All rollup sheets reference `DateFilters!$B$2` and `DateFilters!$B$3` for their date range.

### Sheet 4: `PartsUsage` — Primary Data (28 columns)

One row per part-on-ticket event. Source: `POST /api/v1.0/parts/usage`.

| Col | Letter | Header | Source | Type |
|-----|--------|--------|--------|------|
| 1 | A | TicketActivityPartId | `item.TicketActivityPartId` | UUID (primary key for index) |
| 2 | B | TicketId | `item.TicketId` | UUID |
| 3 | C | TicketNumber | `item.TicketNumber` | Text |
| 4 | D | Subject | `item.Subject` | Text |
| 5 | E | ActivityDate | `item.ActivityDate` | ISO string |
| 6 | F | TicketCreatedDate | `item.CreatedDate` | ISO string |
| 7 | G | TicketClosedDate | `item.ClosedDate` | ISO string |
| 8 | H | PartId | `item.PartId` | UUID |
| 9 | I | PartName | `item.PartName` | Text |
| 10 | J | PartSupplierId | `item.PartSupplierId` | UUID |
| 11 | K | SupplierName | `item.SupplierName` | Text |
| 12 | L | Qty | `item.Qty` | Number |
| 13 | M | CostEach | `item.CostEach` | Currency |
| 14 | N | TotalCost | `item.TotalCost` | Currency |
| 15 | O | Notes | `item.Notes` | Text |
| 16 | P | PurchaseOrderId | `item.PurchaseOrderId` | UUID |
| 17 | Q | PoNumber | `item.PoNumber` | Text |
| 18 | R | PoStatus | `'Approved'`/`'Pending'` + `'Closed'`/`'Open'` | BI-safe string |
| 19 | S | AssignedUserId | `item.AssignedToUserId` | UUID |
| 20 | T | AssignedUser | `item.AssignedToUser.Name` | Text |
| 21 | U | AssignedTeamId | `item.AssignedToTeamId` | UUID |
| 22 | V | AssignedTeam | `item.AssignedToTeam.TeamName` | Text |
| 23 | W | LocationId | `item.LocationId` | UUID |
| 24 | X | Location | `item.Location.Name` | Text |
| 25 | Y | IssueCategoryId | `item.IssueCategory.IssueCategoryId` | UUID |
| 26 | Z | IssueCategoryName | `item.IssueCategory.Name` | Text |
| 27 | AA | IssueTypeId | `item.IssueType.IssueTypeId` | UUID |
| 28 | AB | IssueTypeName | `item.IssueType.Name` | Text |

**BI-safe transforms:**
- `PoIsApproved`/`PoIsClosed` collapsed into `PoStatus` string (e.g., `"Approved + Open"`, `"Approved + Closed"`, `"Pending"`, `""` when no PO).
- Empty strings for null supplier / PO fields.
- `TotalCost` is stored as-returned — avoids formula recalc risk in tight loops.

### Sheet 5: `PartsCatalog` (9 columns)

One row per part. Source: `GET /api/v1.0/parts`.

| Col | Letter | Header | Source |
|-----|--------|--------|--------|
| 1 | A | PartId | `p.PartId` |
| 2 | B | PartName | `p.Name` |
| 3 | C | StandardCostEach | `p.StandardCostEach` |
| 4 | D | StandardSupplierId | `p.StandardSupplierId` |
| 5 | E | StandardSupplierName | `p.StandardSupplier?.Name` or supplier lookup |
| 6 | F | QuantityOnHand | `p.QuantityOnHand` |
| 7 | G | InventoryValue | `=C×F` (formula column) |
| 8 | H | CreatedDate | `p.CreatedDate` |
| 9 | I | ModifiedDate | `p.ModifiedDate` |

### Sheet 6: `PartSuppliers` (4 columns)

| Col | Letter | Header | Source |
|-----|--------|--------|--------|
| 1 | A | PartSupplierId | `s.PartSupplierId` |
| 2 | B | SupplierName | `s.Name` |
| 3 | C | AddressId | `s.AddressId` |
| 4 | D | AddressText | `s.Address` formatted single-line |

### Sheets 7–8: `Teams` and `Users`

Same layout as `iiq-labor-to-sheets`. Needed for consistent agent → team mapping across rollups. Reuse `ReferenceData.gs` loader from labor project verbatim.

### Sheets 9–20: Rollup Analytics (formula-driven)

All reference `PartsUsage` filtered by `DateFilters!$B$2` and `$B$3` on column `E` (ActivityDate). **Per workspace rule: use ARRAYFORMULA + BYROW patterns, never per-row formulas.** All follow the LET + BYROW + IFERROR(SORT(HSTACK)) pattern documented in `CANONICAL_PATTERNS.md`.

**Column references for formulas** (Name columns only — never IDs):
- `I` = PartName, `K` = SupplierName, `L` = Qty, `N` = TotalCost
- `T` = AssignedUser, `V` = AssignedTeam, `X` = Location
- `Z` = IssueCategoryName, `AB` = IssueTypeName
- `E` = ActivityDate, `Q` = PoNumber, `B` = TicketId

| Sheet | Rows | Columns |
|-------|------|---------|
| **ByPart** | one row per PartName | PartName, QtyUsed, TotalCost, UsageCount, TicketCount, AvgCostPerUse |
| **BySupplier** | one row per SupplierName | SupplierName, TotalSpend, PartCount, TicketCount, UsageCount |
| **ByTeam** | one row per AssignedTeam | AssignedTeam, TotalSpend, TicketCount, UsageCount, UniquePartCount |
| **ByAgent** | one row per AssignedUser | AssignedUser, Team, TotalSpend, TicketCount, UsageCount |
| **ByLocation** | one row per Location | Location, TotalSpend, TicketCount, UsageCount |
| **ByIssueCategory** | one row per IssueCategoryName | IssueCategoryName, TotalSpend, TicketCount, UsageCount, AvgCostPerTicket |
| **ByIssueType** | one row per IssueTypeName | IssueTypeName, TotalSpend, TicketCount, UsageCount |
| **ByPurchaseOrder** | one row per PoNumber | PoNumber, PoStatus, TotalSpend, UsageCount, PartCount, FirstDate, LastDate |
| **TopTickets** | top 100 tickets by TotalCost | TicketNumber, Subject, AssignedUser, Location, IssueCategory, TotalCost (sum), PartsCount |
| **MonthlySpend** | one row per YYYY-MM | Month, TotalSpend, TicketCount, UsageCount, TopPart (MODE/INDEX) |
| **LowStock** | parts where QtyOnHand ≤ `LOW_STOCK_THRESHOLD` | PartName, QtyOnHand, StandardCostEach, SupplierName, 30DayUsage (from PartsUsage) |
| **InventoryValue** | aggregated over PartsCatalog | SupplierName, PartCount, TotalValue, AvgCostEach (filterable by supplier) |

### Sheet 21: `Dashboard`

KPI cards and charts:

- Total Parts Spend (period)
- Total Usage Events (period)
- Unique Tickets with Parts (period)
- Avg Cost per Ticket
- Top Part (by spend)
- Top Supplier (by spend)
- Busiest Team (by spend)
- **Inventory Value on Hand** (sum of PartsCatalog.InventoryValue)
- **Low Stock Alert Count**

Charts: spend by team (bar), spend trend by month (line), top 10 parts (horizontal bar), supplier share (pie).

### Hidden/Infrastructure Sheets

- **PartsUsageIndex** — hidden index mapping `TicketActivityPartId` → row number for O(1) upserts (matches `Index.gs` pattern from labor project)
- **Logs** — operation log, auto-trimmed beyond 1000 rows
- **ActivityFailures** (optional) — track usage fetches that failed for later retry

---

## Google Apps Script Architecture

### File Structure (`scripts/`)

Follow canonical file structure from `CANONICAL_PATTERNS.md`:

| File | Role |
|------|------|
| `Config.gs` | Config read/write, type coercion, config caching, LockService concurrency, `requireNoTriggers`, school year locking, date utilities, logging |
| `ApiClient.gs` | HTTP client with exponential backoff retry (max 5 retries), paginated fetch helpers |
| `DataOrchestrator.gs` | Load state machine: groups loads into phases (reference data → parts catalog → parts usage → reconciliation) |
| `DataValidation.gs` | Post-load validation (usage count snapshot check) and auto-recovery via resumable reconciliation |
| `PartsUsage.gs` | Paginated `/parts/usage` loader with 5.5-min runtime guard (`MAX_RUNTIME_MS`), TotalRows snapshot/drift tracking, upsert via index |
| `PartsCatalog.gs` | Paginated `/parts` loader; full refresh (not upsert — catalog is small and `QuantityOnHand` is point-in-time) |
| `ReferenceData.gs` | Loads suppliers, teams, users (by iterating team members) — copy from labor project |
| `Index.gs` | Hidden `PartsUsageIndex` for O(1) row lookups enabling upsert |
| `Setup.gs` | Creates all sheets with headers, ARRAYFORMULA-based rollups, data validation, protections, Instructions sheet |
| `Triggers.gs` | Time-driven triggers: 10-min monitor for resuming, daily 2 AM catalog + recent-usage refresh |
| `Menu.gs` | `onOpen()` menu: iiQ Parts → Setup, Load Data, Refresh, Troubleshooting |

### Data Flow (Load Phases)

Sequential phases, state-machine driven:

1. **Group 1 — Reference**: PartSuppliers, Teams, Users
2. **Group 2 — Catalog**: PartsCatalog (full refresh each run — it's small)
3. **Group 3 — Usage**: PartsUsage (paginated, resumable, upsert via index)
4. **Group 4 — Reconcile**: Runs only if validation detects usage count shortfall

### Key Patterns (all from `CANONICAL_PATTERNS.md`)

- **Resumable pagination**: `MAX_RUNTIME_MS = 5.5 * 60 * 1000`, checkpoint after each batch
- **Sort every list call**: `$o=ActivityDate%20asc` for bulk, `$o=ModifiedDate%20asc` for incremental refreshes
- **String values in Config**: prevents Sheets auto-formatting numbers as dates
- **Upsert via Index**: `{rowNumber: rowData}` maps, batched `setValues()` calls via `writeBatchedUpdates()`
- **Menu vs trigger pairs**: `refreshX()` (UI, waits for lock) vs `triggerRefreshX()` (headless, skips if busy)
- **School year locking**: lock `SCHOOL_YEAR_*`, `PAGE_SIZE`, `MODULE` once load begins
- **BI-safe transforms**: `PoIsApproved`/`PoIsClosed` → single `PoStatus` string; nulls → empty strings
- **Delete-and-recreate for analytics sheets**: idempotent Setup; one menu click rebuilds everything
- **ARRAYFORMULA for derived columns**: e.g., `PartsCatalog!G2` = `=ARRAYFORMULA(IF(A2:A="","",C2:C*F2:F))` for InventoryValue

### Validation & Reconciliation

After usage load completes, run `validatePartsUsageLoad()`:

1. **Usage count check** — compare `PARTS_USAGE_EXPECTED_COUNT` (from `Paging.TotalRows` snapshot) against unique non-blank `TicketActivityPartId` values in `PartsUsageIndex`. No additional API calls.
2. **Drift detection** — if `FIRST_TOTAL_ROWS` differs from last `TotalRows`, log the drift (new usage events added during load) but don't fail.
3. **Reconcile trigger** — if count shortfall > 5%, set `LOAD_STATE_PARTS_USAGE_RECONCILE` to `pending`. Cap at 2 automatic attempts.

Available manually via: `Menu: iiQ Parts → Troubleshooting → Validate Data`.

### Triggers

| Function | Schedule | Purpose |
|----------|----------|---------|
| `triggerDataLoadMonitor` | Every 10 min | Resume paused loads, run reconciliation if pending |
| `triggerDailyRefresh` | Daily 2 AM | Refresh PartsCatalog (for updated QtyOnHand) + reload last `OPEN_REFRESH_DAYS` of usage |
| `triggerDailyInventorySnapshot` | Daily 6 AM | **Optional** — capture `PartsCatalog.QuantityOnHand` into a `DailyInventory` history sheet for trending |

### Optional: Daily Inventory Snapshot

`QuantityOnHand` is point-in-time only. To trend inventory over time, add `DailyInventory.gs`:

- Columns: `SnapshotDate`, `PartId`, `PartName`, `QuantityOnHand`, `InventoryValue`
- Trigger: daily at 6 AM (after catalog refresh at 2 AM)
- Append-only; auto-trim to 730 rows per part (2 years) to bound growth

This is optional — only enable if the district wants inventory trending. Activate via menu: `iiQ Parts → Setup → Enable Daily Inventory Snapshot`.

---

## Implementation Phases

### Phase 1: Foundation (Day 1–2)

- [ ] Create `iiq-parts-to-sheets` project scaffold (package.json, .clasp.json, .gitignore, README stub)
- [ ] Implement `Config.gs` by copying from `iiq-labor-to-sheets` and adjusting keys
- [ ] Implement `ApiClient.gs` verbatim from labor project
- [ ] Build a `testPartsUsageConnection()` one-shot that pulls page 0 and logs response shape
- [ ] Verify `/parts/usage` + `/parts` + `/parts/suppliers` all authenticate correctly
- [ ] Confirm `PoIsApproved`/`PoIsClosed` presence in real responses; confirm whether a parts-specific filter facet is needed

### Phase 2: Core Data Load (Day 3–4)

- [ ] Implement `ReferenceData.gs` (suppliers, teams, users) — copy + adapt from labor
- [ ] Implement `PartsCatalog.gs` — full refresh load with InventoryValue formula
- [ ] Implement `PartsUsage.gs` — paginated resumable load with upsert via `PartsUsageIndex`
- [ ] Implement `DataOrchestrator.gs` — state machine for load phases
- [ ] Implement `DataValidation.gs` — count snapshot + reconcile trigger
- [ ] Verify a full school-year load completes across multiple resume cycles

### Phase 3: Analytics & Dashboard (Day 5–6)

- [ ] Create all rollup sheets via `Setup.gs` with LET + BYROW + IFERROR(SORT(HSTACK)) formulas
- [ ] Build Dashboard sheet (KPIs + 4 charts)
- [ ] Add ARRAYFORMULA for InventoryValue and LowStock indicator columns
- [ ] Test formulas with empty data, single row, full school year
- [ ] Verify `Name` column references, no `DATEVALUE()`, no array-on-array arithmetic in LET

### Phase 4: Polish & Docs (Day 7)

- [ ] Implement `Triggers.gs` with the 2 standard + 1 optional daily-snapshot trigger
- [ ] Build Instructions sheet (all 8 required sections)
- [ ] Write `README.md`, `GUIDE.md`, `CLAUDE.md`, `CHANGELOG.md`
- [ ] Add Looker Studio dashboard build guide (`docs/looker-studio-setup.md`)
- [ ] `git init` + push to `github.com/scopousiiq/iiq-parts-to-sheets`

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Primary endpoint is `/parts/usage` (not `/tickets` with parts filter) | Returns parts-per-ticket denormalized in one call — cleaner than joining tickets + timeline |
| Page size 2000 | Matches labor project; reduces round trips for large districts |
| Upsert via Index sheet | Labor project pattern — O(1) row lookup, supports idempotent refresh |
| PartsCatalog is full-refresh, not upsert | Catalog is small (typically <1000 parts); `QuantityOnHand` is point-in-time anyway |
| `PoStatus` as single string (not two booleans) | BI-safe; Looker Studio/Power BI handle booleans inconsistently |
| School year boundary | Consistent with `iiq-tickets-to-sheets` and `iiq-labor-to-sheets`; bounds sheet growth |
| Daily inventory snapshot is **optional** | Not every district wants inventory trending; keep base project lean |
| ARRAYFORMULA for derived columns | Scales to 1M+ rows without timeouts (per workspace rule) |

---

## Open Questions to Resolve During Phase 1

1. **Parts-specific filter facet for `/parts/usage`?** The endpoint extends `Ticket`, so ticket facets work. Confirm whether there's a specific `totalpartscost` or similar facet that limits results to tickets with parts. If yes, use it to reduce payload. If no, the endpoint may already be pre-filtered to parts-ticket records.
2. **Does `PartUsage` echo the ticket's `LaborType`, `ResolutionAction`, `WorkflowStep.StatusName`?** If yes, we can add those as columns. If the ticket context is abbreviated, stick with the subset listed in the `PartsUsage` column layout.
3. **Are facilities-module parts included in `/parts/usage`, or do we need to call `/parts-facilities` separately?** Check whether `MODULE=Facilities` with ProductId header alone routes correctly. Labor project uses a `MODULE` toggle; parts may work the same.
4. **Deleted part handling** — if a `PartId` referenced in `PartsUsage` is deleted from the catalog, the `PartsCatalog` won't have it. Keep the denormalized `PartName` on `PartsUsage` so rollups don't lose the record.

---

## Security Considerations

- **Bearer token storage** — same as labor project. Default: stored in Config sheet, protected range. `PropertiesService.getScriptProperties()` available as alternative for automated-sync deployments.
- **Access control** — share the sheet only with authorized personnel. Parts spend data may be procurement-sensitive.
- **PII** — usage entries include requester name and technician name (via extended Ticket fields). Treat the sheet as internal-only.
- **Credential hygiene** — follow the workspace rule of never committing `.env`-style files; `.clasp.json` is in `.gitignore`.

---

## Success Criteria

- [ ] Full school-year parts usage loads without errors across multiple resume cycles
- [ ] Rollup totals match IncidentIQ's Parts module UI totals (spot-check 5 parts and 5 suppliers)
- [ ] Date filter dropdown correctly scopes all rollup sheets
- [ ] Dashboard loads in <5s with a full year of data (~10k usage events)
- [ ] Low stock sheet correctly flags parts at/below threshold
- [ ] Daily refresh trigger updates `PartsCatalog.QuantityOnHand` nightly
- [ ] District can regenerate any rollup sheet via menu without code changes
- [ ] Instructions sheet is complete and accurate — a new admin can set up without reading the GitHub repo

---

## Files Summary

| File | Type | Purpose |
|------|------|---------|
| `scripts/Config.gs` | Script | Config, types, locks, logging |
| `scripts/ApiClient.gs` | Script | HTTP with retry |
| `scripts/PartsUsage.gs` | Script | Primary data loader |
| `scripts/PartsCatalog.gs` | Script | Catalog loader |
| `scripts/ReferenceData.gs` | Script | Suppliers, teams, users |
| `scripts/DataOrchestrator.gs` | Script | Load state machine |
| `scripts/DataValidation.gs` | Script | Post-load validation + reconcile |
| `scripts/Index.gs` | Script | Hidden index for upserts |
| `scripts/Setup.gs` | Script | Sheet creation, headers, formulas, Instructions |
| `scripts/Menu.gs` | Script | Menu structure |
| `scripts/Triggers.gs` | Script | Time-driven functions |
| `scripts/DailyInventory.gs` | Script | **Optional** — daily snapshot |
| `scripts/appsscript.json` | Manifest | Apps Script project config |
| `README.md` | Doc | Quick start, admin audience |
| `GUIDE.md` | Doc | Detailed setup, power user audience |
| `CLAUDE.md` | Doc | AI assistant / developer context |
| `CHANGELOG.md` | Doc | Dated change history |
| `docs/looker-studio-setup.md` | Doc | Dashboard build guide |
