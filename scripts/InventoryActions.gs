/**
 * InventoryActions.gs - Per-ticket parts loader.
 *
 * Iterates the Tickets sheet (already populated by TicketData.gs) and for each
 * TicketId queries POST /v1.0/inventory/actions/query with EntityId=<TicketId>.
 * Filters client-side to actual parts-on-ticket consumption (Quantity < 0,
 * InventoryActionTypeId = TICKET_USAGE), denormalizes ticket context inline
 * from buildTicketContextMap(), and appends to InventoryActions sheet.
 *
 * Resumable via TICKET_PROCESS_INDEX (the row in Tickets we're currently on).
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

  const lastTicketRow = ticketsSheet.getLastRow();
  if (lastTicketRow < 2) {
    setLoadState(DATA_LOAD_TYPES.INVENTORY_ACTIONS, LOAD_STATES.COMPLETE);
    updateLastSync();
    logOperation('INVENTORY_ACTIONS', 'INFO', 'No tickets to process.');
    return;
  }

  const contextMap = buildTicketContextMap();

  // On first invocation, clear the InventoryActions sheet so we start fresh.
  let ticketIndex = getIntValue(getConfig('TICKET_PROCESS_INDEX'), 0);
  if (ticketIndex <= 0) {
    if (actionsSheet.getLastRow() > 1) {
      actionsSheet.getRange(2, 1, actionsSheet.getLastRow() - 1, actionsSheet.getLastColumn()).clearContent();
    }
    ticketIndex = 0;
  }

  // Read TicketIds in one batch — fast and avoids repeated sheet calls.
  const ticketIds = ticketsSheet.getRange(2, 1, lastTicketRow - 1, 1).getValues().map(function(r) { return r[0]; });

  const throttleMs = getThrottleMs();
  let appendBuffer = [];
  let processedThisRun = 0;
  let actionsAppendedThisRun = 0;

  while (ticketIndex < ticketIds.length) {
    if (Date.now() - startTime >= ACTIONS_MAX_RUNTIME_MS) {
      flushAppendBuffer_(actionsSheet, appendBuffer);
      writeConfigValueDirect('TICKET_PROCESS_INDEX', String(ticketIndex));
      logOperation('INVENTORY_ACTIONS', 'INFO',
        'Paused at ticket index ' + ticketIndex + '/' + ticketIds.length +
        '. This run: processed=' + processedThisRun + ', actions=' + actionsAppendedThisRun);
      return;
    }

    const ticketId = ticketIds[ticketIndex];
    if (!ticketId) {
      ticketIndex++;
      continue;
    }

    const context = contextMap[ticketId] || {};
    const actions = fetchAllActionsForTicket_(ticketId);
    const usageActions = actions.filter(function(a) {
      return a.InventoryActionTypeId === INVENTORY_ACTION_TYPE_TICKET_USAGE &&
        typeof a.Quantity === 'number' &&
        a.Quantity < 0;
    });

    usageActions.forEach(function(action) {
      appendBuffer.push(mapInventoryActionRow_(action, ticketId, context));
    });
    actionsAppendedThisRun += usageActions.length;

    // Flush in modest batches so the sheet stays close to current.
    if (appendBuffer.length >= 200) {
      flushAppendBuffer_(actionsSheet, appendBuffer);
      appendBuffer = [];
    }

    ticketIndex++;
    processedThisRun++;
    writeConfigValueDirect('TICKET_PROCESS_INDEX', String(ticketIndex));

    if (throttleMs > 0) Utilities.sleep(throttleMs);
  }

  flushAppendBuffer_(actionsSheet, appendBuffer);
  setLoadState(DATA_LOAD_TYPES.INVENTORY_ACTIONS, LOAD_STATES.COMPLETE);
  writeConfigValueDirect('TICKET_PROCESS_INDEX', '');
  updateLastSync();
  logOperation('INVENTORY_ACTIONS', 'SUCCESS',
    'Load complete. Tickets processed: ' + ticketIds.length +
    ', actions written this run: ' + actionsAppendedThisRun);
}

function fetchAllActionsForTicket_(ticketId) {
  // Per-ticket volume is small (almost always < 50 actions); one page handles
  // it, but we paginate defensively in case a ticket has many entries.
  const out = [];
  const pageSize = 500;
  let page = 0;
  while (true) {
    const sort = encodeURIComponent('ActionDate desc');
    const endpoint = '/v1.0/inventory/actions/query?$p=' + page + '&$s=' + pageSize + '&$o=' + sort;
    const response = apiRequest('POST', endpoint, { EntityId: ticketId });
    const items = response && response.Items ? response.Items : [];
    if (items.length === 0) break;
    items.forEach(function(item) { out.push(item); });

    if (response.Paging && response.Paging.PageCount !== undefined) {
      if (page + 1 >= response.Paging.PageCount) break;
    } else if (items.length < pageSize) {
      break;
    }
    page++;
  }
  return out;
}

function mapInventoryActionRow_(item, ticketId, context) {
  const inv = item.Inventory || {};
  const invItem = inv.InventoryItem || {};
  const category = invItem.Category || {};
  const location = inv.Location || {};
  const user = item.CreatedByUser || {};

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
    invItem.InventoryItemId || '',
    invItem.Name || '',
    invItem.ItemNumber || '',
    category.Name || '',
    location.LocationId || '',
    location.Name || '',
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
