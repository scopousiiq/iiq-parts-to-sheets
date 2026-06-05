/**
 * InventoryActions.gs - Bulk parts-usage loader.
 *
 * One paginated POST /v1.0/inventory/actions/query with the server-side
 * ActionTypeId=TICKET_USAGE filter (one of the six typed filters this
 * endpoint honors) instead of one query per ticket: ~150 calls for ~70k
 * usage actions vs 8,000 calls for 8,000 tickets.
 *
 * Verified live against kcs tenant 2026-06-05:
 *   - ActionTypeId filters server-side (TotalRows 70,511 vs 78,676 unfiltered)
 *   - With Fields projection, items include Inventory (InventoryItemId,
 *     LocationId), CreatedByUser, and Ticket (TicketId/Number/Subject)
 *   - The nested InventoryItem/Category/Location expansions are NOT returned
 *     in bulk mode, so item name/number/category are joined client-side from
 *     the InventoryItems catalog sheet (Group 1)
 *
 * Scoping: rows are kept only when RelatedEntityId matches a ticket in the
 * Tickets sheet (Group 2), which is already facet-scoped to the school-year
 * window — the same semantics as the previous per-ticket loader.
 *
 * Resumable via ACTIONS_LOAD_PAGE.
 */

const ACTIONS_MAX_RUNTIME_MS = 5.5 * 60 * 1000;
const INVENTORY_ACTION_TYPE_TICKET_USAGE = 'd3ea78e4-707a-ec11-ba97-88665a256e9d';

function loadInventoryActionsForTickets() {
  cacheConfigRowPositions();
  const startTime = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ticketsSheet = ss.getSheetByName('Tickets');
  const actionsSheet = ss.getSheetByName('InventoryActions');
  if (!ticketsSheet || !actionsSheet) {
    throw new Error('Tickets and InventoryActions sheets are required.');
  }

  setLoadState(DATA_LOAD_TYPES.INVENTORY_ACTIONS, LOAD_STATES.IN_PROGRESS);

  if (ticketsSheet.getLastRow() < 2) {
    setLoadState(DATA_LOAD_TYPES.INVENTORY_ACTIONS, LOAD_STATES.COMPLETE);
    updateLastSync();
    logOperation('INVENTORY_ACTIONS', 'INFO', 'No tickets to process.');
    return;
  }

  const contextMap = buildTicketContextMap();
  const catalogMap = buildCatalogMap_();

  // Resume from the saved page cursor; on a fresh start, clear the sheet.
  let page = getIntValue(getConfig('ACTIONS_LOAD_PAGE'), 0);
  if (page <= 0) {
    page = 0;
    if (actionsSheet.getLastRow() > 1) {
      actionsSheet.getRange(2, 1, actionsSheet.getLastRow() - 1, actionsSheet.getLastColumn()).clearContent();
    }
  }

  const pageSize = getPageSize();
  const throttleMs = getThrottleMs();
  let keptThisRun = 0;

  while (true) {
    if (Date.now() - startTime >= ACTIONS_MAX_RUNTIME_MS) {
      logOperation('INVENTORY_ACTIONS', 'INFO',
        'Paused at page ' + page + '. Actions kept this run: ' + keptThisRun);
      return;
    }

    const response = fetchUsageActionsPage_(page, pageSize);
    const items = response && response.Items ? response.Items : [];
    if (items.length === 0) {
      finalizeActionsLoad_(actionsSheet, keptThisRun);
      return;
    }

    const rows = [];
    items.forEach(function(item) {
      // Belt and braces: the server already filters by ActionTypeId, but a
      // reversal/return entry shares the type with positive quantity.
      if (item.InventoryActionTypeId !== INVENTORY_ACTION_TYPE_TICKET_USAGE) return;
      if (!(typeof item.Quantity === 'number' && item.Quantity < 0)) return;
      const ticketId = item.RelatedEntityId || '';
      const context = contextMap[ticketId];
      if (!context) return; // not one of our school-year tickets
      rows.push(mapInventoryActionRow_(item, ticketId, context, catalogMap));
    });

    if (rows.length > 0) {
      flushAppendBuffer_(actionsSheet, rows);
      keptThisRun += rows.length;
    }

    page++;
    writeConfigValueDirect('ACTIONS_LOAD_PAGE', String(page));

    if (response.Paging && response.Paging.PageCount !== undefined && page >= response.Paging.PageCount) {
      finalizeActionsLoad_(actionsSheet, keptThisRun);
      return;
    }

    if (throttleMs > 0) Utilities.sleep(throttleMs);
  }
}

function finalizeActionsLoad_(actionsSheet, keptThisRun) {
  setLoadState(DATA_LOAD_TYPES.INVENTORY_ACTIONS, LOAD_STATES.COMPLETE);
  writeConfigValueDirect('ACTIONS_LOAD_PAGE', '');
  updateLastSync();
  const total = Math.max(0, actionsSheet.getLastRow() - 1);
  logOperation('INVENTORY_ACTIONS', 'SUCCESS',
    'Load complete. Usage actions on file: ' + total + ' (this run: ' + keptThisRun + ')');
}

function fetchUsageActionsPage_(page, pageSize) {
  // Sorted CreatedDate Ascending per workspace memory rule (stable bulk
  // pagination — new records append past the cursor instead of shifting it).
  const sort = encodeURIComponent('CreatedDate Ascending');
  const endpoint = '/v1.0/inventory/actions/query?$p=' + page + '&$s=' + pageSize + '&$o=' + sort;
  return apiRequest('POST', endpoint, {
    ActionTypeId: INVENTORY_ACTION_TYPE_TICKET_USAGE,
    Fields: ['Inventory', 'CreatedByUser', 'Ticket']
  });
}

// InventoryItemId -> { name, number, category } from the InventoryItems
// catalog sheet (Group 1). Bulk mode does not expand InventoryItem, so the
// join happens here. Items deleted from the catalog resolve to blanks.
function buildCatalogMap_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('InventoryItems');
  if (!sheet || sheet.getLastRow() < 2) return {};
  // Columns A-D: InventoryItemId, Name, ItemNumber, CategoryName
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  const map = {};
  data.forEach(function(row) {
    if (!row[0]) return;
    map[row[0]] = { name: row[1] || '', number: row[2] || '', category: row[3] || '' };
  });
  return map;
}

function mapInventoryActionRow_(item, ticketId, context, catalogMap) {
  const inv = item.Inventory || {};
  const user = item.CreatedByUser || {};
  const itemId = inv.InventoryItemId || '';
  const cat = catalogMap[itemId] || {};

  const qty = typeof item.Quantity === 'number' ? item.Quantity : 0;
  const qtyAbs = Math.abs(qty);
  const unitCost = typeof item.UnitCost === 'number' ? item.UnitCost : 0;
  const totalCost = qtyAbs * unitCost;

  return [
    item.InventoryActionId || '',
    parseApiDate(item.ActionDate || ''),
    item.InventoryActionTypeId || '',
    qty,
    qtyAbs,
    unitCost,
    totalCost,
    itemId,
    cat.name || '',
    cat.number || '',
    cat.category || '',
    inv.LocationId || '',
    '', // StockLocationName — no name source in bulk mode (was also blank per-ticket)
    ticketId,
    context.ticketNumber || '',
    context.subject || '',
    user.UserId || '',
    user.Name || '',
    item.Description || '',
    parseApiDate(item.CreatedDate || ''),
    context.assignedUser || '',
    context.assignedTeam || '',
    context.locationName || '',
    context.issueCategoryName || '',
    context.issueTypeName || ''
  ];
}

function flushAppendBuffer_(actionsSheet, buffer) {
  if (buffer.length === 0) return;
  const startRow = actionsSheet.getLastRow() + 1;
  actionsSheet.getRange(startRow, 1, buffer.length, buffer[0].length).setValues(buffer);
}
