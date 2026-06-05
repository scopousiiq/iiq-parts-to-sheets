# iiq-parts-to-sheets

Google Apps Script + Google Sheets project that pulls **parts (inventory) usage and cost data** from the Incident IQ API into a sheet, with formula-based rollups by category, item, team, location, and ticket.

This is a companion to:
- [`iiq-tickets-to-sheets`](https://github.com/scopousiiq/iiq-tickets-to-sheets) — ticket + SLA data
- [`iiq-labor-to-sheets`](https://github.com/scopousiiq/iiq-labor-to-sheets) — labor hours and cost per ticket

Together they cover the **tickets + labor + parts** trio that schools need for full operating-cost reporting.

## What you get

| Sheet | Purpose |
|-------|---------|
| **Instructions** | In-sheet setup guide and full reference — the primary end-user docs |
| **Dashboard** | KPI tiles: total parts cost, qty used, action count, tickets-with-parts |
| **ByCategory** | Parts cost & qty grouped by inventory category |
| **ByItem** | Top parts by total spend |
| **ByTeam** | Parts cost by assigned ticket team |
| **ByLocation** | Parts cost by ticket location |
| **ByTicket** | Per-ticket parts roll-up (cost, qty, action count) |
| **MonthlyTrend** | Parts cost by month |
| **InventoryActions** | Raw data — one row per inventory action |
| **Tickets** | Ticket context for tickets with parts usage |
| **InventoryItems** | Parts catalog reference |
| **Config / Logs / DateFilters** | Configuration and observability |

## Data source

The load runs in three sequential groups:

1. **`POST /api/v1.0/inventory/items/query`** — full parts catalog reference.
2. **`POST /api/v1.0/tickets`** with `Facet: 'InventoryUsedDate'` — the driver. This server-side facet returns exactly the tickets that had parts consumed in the reporting window, with full context (assigned user/team, location, issue, status).
3. **`POST /api/v1.0/inventory/actions/query`** — one bulk paginated pull with the server-side `ActionTypeId` (ticket-usage) filter. Rows are kept client-side when they are real consumption events (negative quantity) on a step-2 ticket, then denormalized with ticket context and catalog item details.

> **Why this shape?** The `/inventory/actions/query` endpoint ignores date-range filters, so the date window is applied via step 2: the tickets endpoint's `InventoryUsedDate` facet is the only server-side date scoping available. The bulk `ActionTypeId` filter keeps the pull to one call per page (~150 calls for ~70k usage actions) instead of one call per ticket.

## Quick start

1. Create a new Google Sheet, open Extensions → Apps Script
2. Paste each `scripts/*.gs` file into a matching Apps Script file
3. Copy `scripts/appsscript.json` into the manifest
4. Reload the sheet — an **iiQ Data** menu appears
5. **iiQ Data → Setup → Run Complete Setup** — ⚠️ clean slate: deletes and recreates all sheets (re-running it later wipes loaded data and credentials)
6. Fill in the Config sheet:
   - `API_BASE_URL` — e.g. `https://district.incidentiq.com`
   - `BEARER_TOKEN` — JWT
   - `SITE_ID` — site UUID
   - `MODULE` — `Ticketing` or `Facilities` (dropdown)
   - `SCHOOL_YEAR_START` / `SCHOOL_YEAR_END` — pre-filled with the current school year (`YYYY-MM-DD`)
7. **iiQ Data → Setup → Test API Connection**
8. **iiQ Data → Load Data → Start Initial Load**
9. **iiQ Data → Setup → Setup Automated Triggers** (10-min monitor + daily 2 AM refresh)

## License

MIT
