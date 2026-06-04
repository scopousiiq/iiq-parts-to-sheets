/**
 * DataOrchestrator.gs - Load orchestration and monitoring.
 *
 * Three sequential groups; each can pause and resume via the 10-minute monitor
 * trigger:
 *
 *   Group 1 — INVENTORY_ITEMS:     pulls the parts catalog (small, fast)
 *   Group 2 — TICKETS_WITH_PARTS:  POST /v1.0/tickets with InventoryUsedDate
 *                                  facet → only tickets that consumed parts
 *                                  in the school-year window
 *   Group 3 — INVENTORY_ACTIONS:   for each TicketId, POST /v1.0/inventory/
 *                                  actions/query with EntityId, filter to
 *                                  TICKET_USAGE actions, denormalize ticket
 *                                  context inline
 */

const DATA_LOAD_TYPES = {
  INVENTORY_ITEMS: 'INVENTORY_ITEMS',
  TICKETS_WITH_PARTS: 'TICKETS_WITH_PARTS',
  INVENTORY_ACTIONS: 'INVENTORY_ACTIONS'
};

const LOAD_GROUPS = {
  1: [DATA_LOAD_TYPES.INVENTORY_ITEMS],
  2: [DATA_LOAD_TYPES.TICKETS_WITH_PARTS],
  3: [DATA_LOAD_TYPES.INVENTORY_ACTIONS]
};

const LOAD_STATES = {
  IDLE: 'idle',
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETE: 'complete',
  ERROR: 'error'
};

function getLoadState(dataType) {
  return getConfig('LOAD_STATE_' + dataType) || LOAD_STATES.IDLE;
}

function setLoadState(dataType, state, message) {
  setConfig('LOAD_STATE_' + dataType, state);
  if (message) {
    setConfig('LOAD_STATE_' + dataType + '_MESSAGE', message);
  }
  logOperation('ORCHESTRATOR', 'INFO', dataType + ' -> ' + state + (message ? ': ' + message : ''));
}

function clearLoadStates() {
  Object.keys(DATA_LOAD_TYPES).forEach(key => {
    setLoadState(DATA_LOAD_TYPES[key], LOAD_STATES.IDLE);
  });
}

function initializeAllLoads() {
  Object.keys(DATA_LOAD_TYPES).forEach(key => {
    setLoadState(DATA_LOAD_TYPES[key], LOAD_STATES.PENDING);
  });

  setConfig('TICKET_LOAD_PAGE', '');
  setConfig('TICKET_LOAD_FIRST_TOTAL_ROWS', '');
  setConfig('TICKET_LOAD_EXPECTED_COUNT', '');
  setConfig('TICKET_PROCESS_INDEX', '');
}

function isGroupComplete(groupNum) {
  const types = LOAD_GROUPS[groupNum] || [];
  return types.every(type => getLoadState(type) === LOAD_STATES.COMPLETE);
}

function findPendingInGroup(groupNum) {
  const types = LOAD_GROUPS[groupNum] || [];
  for (const type of types) {
    if (getLoadState(type) === LOAD_STATES.IN_PROGRESS) return type;
  }
  for (const type of types) {
    if (getLoadState(type) === LOAD_STATES.PENDING) return type;
  }
  for (const type of types) {
    if (getLoadState(type) === LOAD_STATES.ERROR) return type;
  }
  return null;
}

function getNextPendingLoad() {
  for (const groupNum in LOAD_GROUPS) {
    const group = parseInt(groupNum, 10);
    for (let g = 1; g < group; g++) {
      if (!isGroupComplete(g)) {
        return findPendingInGroup(g);
      }
    }
    const pending = findPendingInGroup(group);
    if (pending) return pending;
  }
  return null;
}

function executeNextLoad() {
  const lock = acquireScriptLock();
  if (!lock) {
    showOperationBusyMessage('Continue Loading');
    return false;
  }
  try {
    return executeNextLoadInternal_();
  } finally {
    releaseScriptLock(lock);
  }
}

function executeNextLoadInternal_() {
  const validation = validateConfig();
  if (!validation.isValid) {
    logOperation('ORCHESTRATOR', 'ERROR', 'Missing config: ' + validation.missing.join(', '));
    return false;
  }

  const nextLoad = getNextPendingLoad();
  if (!nextLoad) {
    logOperation('ORCHESTRATOR', 'INFO', 'No pending loads');
    return false;
  }

  try {
    switch (nextLoad) {
      case DATA_LOAD_TYPES.INVENTORY_ITEMS:
        setLoadState(nextLoad, LOAD_STATES.IN_PROGRESS);
        loadInventoryItems();
        setLoadState(nextLoad, LOAD_STATES.COMPLETE);
        break;
      case DATA_LOAD_TYPES.TICKETS_WITH_PARTS:
        loadTicketsWithParts();
        break;
      case DATA_LOAD_TYPES.INVENTORY_ACTIONS:
        loadInventoryActionsForTickets();
        break;
      default:
        throw new Error('Unknown load type: ' + nextLoad);
    }
    return true;
  } catch (error) {
    setLoadState(nextLoad, LOAD_STATES.ERROR, error.message);
    logOperation('ORCHESTRATOR', 'ERROR', 'Load failed: ' + nextLoad + ' - ' + error.message);
    return false;
  }
}

function startInitialLoad() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Start Initial Load',
    'This will load:\n' +
    '  1. Parts catalog (InventoryItems)\n' +
    '  2. Tickets that consumed parts in the school year\n' +
    '  3. Inventory action events for each ticket\n\n' +
    'The process is resumable and may take a while for large datasets.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  const lock = acquireScriptLock();
  if (!lock) { showOperationBusyMessage('Start Initial Load'); return; }
  try {
    lockSchoolYearConfig();
    assertSchoolYearUnchanged();
    initializeAllLoads();

    while (true) {
      var previousPending = getNextPendingLoad();
      var executed = executeNextLoadInternal_();
      if (!executed) break;
      var currentPending = getNextPendingLoad();
      if (currentPending && currentPending === previousPending) break;
    }

    if (getNextPendingLoad()) {
      ensureMonitorTrigger();
    }
  } finally {
    releaseScriptLock(lock);
  }
}

function showLoadStatus() {
  const ui = SpreadsheetApp.getUi();
  const lines = [];
  Object.keys(DATA_LOAD_TYPES).forEach(key => {
    const type = DATA_LOAD_TYPES[key];
    lines.push(type + ': ' + getLoadState(type));
  });
  lines.push('');
  lines.push('Last sync: ' + (getConfig('LAST_SYNC') || 'never'));
  ui.alert('Load Status', lines.join('\n'), ui.ButtonSet.OK);
}
