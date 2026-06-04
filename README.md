# iiq-parts-to-sheets

Google Apps Script + Google Sheets project that pulls **parts (inventory) usage and cost data** from the Incident IQ API into a sheet, with formula-based rollups by category, item, team, location, and ticket.

This is a companion to:
- [`iiq-tickets-to-sheets`](https://github.com/scopousiiq/iiq-tickets-to-sheets) — ticket + SLA data
- `iiq-labor-to-sheets` — labor hours and cost per ticket

Together they cover the **tickets + labor + parts** trio that schools need for full operating-cost reporting.

## What you get

| Sheet | Purpose |
|-------|---------|
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

Single primary endpoint: **`POST /api/v1.0/inventory/actions/query`**

Each `InventoryAction` is a stock-change event (parts used on tickets, parts received, parts adjusted). For ticket-related actions, `RelatedEntityId` references the ticket. The request expands `Inventory` (catalog item + location), `Ticket`, and `CreatedByUser` via the `Fields` projection so most context is available in one call.

Two helper endpoints:
- `POST /api/v1.0/tickets` — enrich with assigned user/team/location/category/status for tickets that have parts usage
- `POST /api/v1.0/inventory/items/query` — full catalog reference

## Quick start

1. Create a new Google Sheet, open Extensions → Apps Script
2. Paste each `scripts/*.gs` file into a matching Apps Script file
3. Copy `scripts/appsscript.json` into the manifest
4. Reload the sheet — an **iiQ Data** menu appears
5. **iiQ Data → Setup → Run Complete Setup**
6. Fill in the Config sheet:
   - `API_BASE_URL` — e.g. `https://district.incidentiq.com`
   - `BEARER_TOKEN` — JWT
   - `SITE_ID` — site UUID
   - `MODULE` — `Ticketing` or `Facilities`
   - `SCHOOL_YEAR_START` / `SCHOOL_YEAR_END` — reporting period
7. **iiQ Data → Setup → Test API Connection**
8. **iiQ Data → Load Data → Start Initial Load**
9. **iiQ Data → Setup → Setup Automated Triggers** (10-min monitor + daily 2 AM refresh)

## License

MIT
