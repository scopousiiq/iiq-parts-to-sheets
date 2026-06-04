/**
 * Triggers.gs - Time-driven triggers
 */

function ensureMonitorTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const hasMonitor = triggers.some(function(t) {
    return t.getHandlerFunction() === 'triggerDataLoadMonitor';
  });
  if (!hasMonitor) {
    ScriptApp.newTrigger('triggerDataLoadMonitor')
      .timeBased()
      .everyMinutes(10)
      .create();
    logOperation('TRIGGERS', 'INFO', 'Auto-installed monitor trigger for load continuation');
  }
}

function setupDefaultTriggers() {
  removeAllTriggers();

  ScriptApp.newTrigger('triggerDataLoadMonitor')
    .timeBased()
    .everyMinutes(10)
    .create();

  ScriptApp.newTrigger('triggerDailyRefresh')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .create();

  logOperation('TRIGGERS', 'SUCCESS', 'Installed default triggers');
  SpreadsheetApp.getUi().alert('Triggers Installed', 'Monitor (10 min) and daily refresh (2 AM) installed.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function removeAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  logOperation('TRIGGERS', 'SUCCESS', 'Removed all triggers');
}

function showAutomationStatus() {
  const ui = SpreadsheetApp.getUi();
  const triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) {
    ui.alert('Automation Status', 'No triggers installed.', ui.ButtonSet.OK);
    return;
  }
  const lines = triggers.map(function(t) { return '• ' + t.getHandlerFunction(); }).join('\n');
  ui.alert('Automation Status', triggers.length + ' trigger(s) active:\n' + lines, ui.ButtonSet.OK);
}

function triggerDataLoadMonitor() {
  const lock = tryAcquireScriptLock();
  if (!lock) {
    logOperation('TRIGGER_MONITOR', 'SKIP', 'Another operation is running');
    return;
  }
  try {
    logOperation('TRIGGER_MONITOR', 'INFO', 'Monitor triggered');
    const executed = executeNextLoadInternal_();
    if (executed) {
      logOperation('TRIGGER_MONITOR', 'SUCCESS', 'Load executed');
    }
  } catch (error) {
    logOperation('TRIGGER_MONITOR', 'ERROR', error.message);
  } finally {
    releaseScriptLock(lock);
  }
}

function triggerDailyRefresh() {
  const lock = tryAcquireScriptLock();
  if (!lock) {
    logOperation('TRIGGER_DAILY', 'SKIP', 'Another operation is running');
    return;
  }
  try {
    logOperation('TRIGGER_DAILY', 'INFO', 'Daily refresh triggered');

    // Skip until initial loads are complete.
    const allComplete = [
      DATA_LOAD_TYPES.INVENTORY_ITEMS,
      DATA_LOAD_TYPES.TICKETS_WITH_PARTS,
      DATA_LOAD_TYPES.INVENTORY_ACTIONS
    ].every(function(t) { return getLoadState(t) === LOAD_STATES.COMPLETE; });

    if (!allComplete) {
      logOperation('TRIGGER_DAILY', 'INFO', 'Initial load incomplete - skipping daily refresh');
      return;
    }

    // Re-pull tickets then per-ticket parts. Items catalog refresh is left
    // out of the daily cycle — refresh via menu when needed.
    setLoadState(DATA_LOAD_TYPES.TICKETS_WITH_PARTS, LOAD_STATES.PENDING);
    setLoadState(DATA_LOAD_TYPES.INVENTORY_ACTIONS, LOAD_STATES.PENDING);
    setConfig('TICKET_LOAD_PAGE', '');
    setConfig('TICKET_LOAD_FIRST_TOTAL_ROWS', '');
    setConfig('TICKET_PROCESS_INDEX', '');

    executeNextLoadInternal_();
  } finally {
    releaseScriptLock(lock);
  }
}
