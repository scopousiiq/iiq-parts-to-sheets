/**
 * Menu.gs - iiQ Data menu
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('iiQ Data')
    .addItem('Check Status', 'showLoadStatus')
    .addItem('View Dashboard', 'openDashboard')
    .addSeparator()
    .addSubMenu(ui.createMenu('Setup')
      .addItem('Run Complete Setup', 'setupPartsTrackerDashboard')
      .addItem('Regenerate Analytics Sheets', 'regenerateAnalyticsSheetsWithConfirm')
      .addItem('Test API Connection', 'showApiTestResult')
      .addItem('Verify Configuration', 'showConfigStatus')
      .addSeparator()
      .addItem('Setup Automated Triggers', 'setupDefaultTriggers')
      .addItem('Remove Automated Triggers', 'removeAllTriggers')
      .addItem('View Trigger Status', 'showAutomationStatus'))
    .addSubMenu(ui.createMenu('Load Data')
      .addItem('Start Initial Load', 'startInitialLoad')
      .addItem('Continue Loading', 'executeNextLoad')
      .addItem('Refresh Inventory Items', 'menuRefreshInventoryItems'))
    .addSubMenu(ui.createMenu('Troubleshooting')
      .addItem('View Logs', 'showLogs')
      .addItem('Reset Load States', 'resetLoadStatesWithConfirm')
      .addItem('Full Reload (Clear Data)', 'startFullReloadWithConfirm'))
    .addToUi();
}

function openDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Dashboard');
  if (sheet) ss.setActiveSheet(sheet);
}

function showLogs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Logs');
  if (sheet) {
    ss.setActiveSheet(sheet);
  } else {
    SpreadsheetApp.getUi().alert('Logs sheet not found.');
  }
}

function showConfigStatus() {
  const validation = validateConfig();
  const ui = SpreadsheetApp.getUi();

  if (validation.isValid) {
    ui.alert('Configuration Valid',
      'All required settings are configured.\n\n' +
      'API URL: ' + getConfig('API_BASE_URL') + '\n' +
      'Site ID: ' + getConfig('SITE_ID') + '\n' +
      'Module: ' + getConfig('MODULE') + '\n' +
      'School Year: ' + getConfig('SCHOOL_YEAR_START') + ' to ' + getConfig('SCHOOL_YEAR_END') + '\n' +
      'School Year Locked: ' + (isSchoolYearLocked() ? 'Yes' : 'No'),
      ui.ButtonSet.OK);
  } else {
    ui.alert('Configuration Incomplete',
      'Missing required settings:\n\n' + validation.missing.join('\n') +
      '\n\nPlease update the Config sheet.',
      ui.ButtonSet.OK);
  }
}

function menuRefreshInventoryItems() {
  const lock = acquireScriptLock();
  if (!lock) { showOperationBusyMessage('Refresh Inventory Items'); return; }
  try {
    loadInventoryItems();
    SpreadsheetApp.getUi().alert('Done', 'Inventory items refreshed.', SpreadsheetApp.getUi().ButtonSet.OK);
  } finally {
    releaseScriptLock(lock);
  }
}

function resetLoadStatesWithConfirm() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Reset Load States',
    'This will reset all load states and progress.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  const lock = acquireScriptLock();
  if (!lock) { showOperationBusyMessage('Reset Load States'); return; }
  try {
    resetLoadStates();
  } finally {
    releaseScriptLock(lock);
  }
  ui.alert('Reset Complete', 'Load states have been reset.', ui.ButtonSet.OK);
}

function startFullReloadWithConfirm() {
  if (!requireNoTriggers('Full Reload')) return;

  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Full Reload (Clear Data)',
    'This will delete all data from InventoryActions, Tickets, and InventoryItems.\n' +
    'It will also unlock the school year configuration so you can change dates.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  const confirm = ui.alert('Confirm', 'This cannot be undone. Continue?', ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  const lock = acquireScriptLock();
  if (!lock) { showOperationBusyMessage('Full Reload'); return; }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    unlockSchoolYearConfig();
    ['InventoryActions', 'Tickets', 'InventoryItems'].forEach(function(name) {
      const sheet = ss.getSheetByName(name);
      if (sheet && sheet.getLastRow() > 1) {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clear();
      }
    });
    setConfig('LAST_SYNC', '');
    resetLoadStates();
  } finally {
    releaseScriptLock(lock);
  }
  ui.alert('Data Cleared', 'All data has been cleared. Update the school year dates, then run Start Initial Load.', ui.ButtonSet.OK);
}

function resetLoadStates() {
  clearLoadStates();
  setConfig('TICKET_LOAD_PAGE', '');
  setConfig('TICKET_LOAD_FIRST_TOTAL_ROWS', '');
  setConfig('TICKET_LOAD_EXPECTED_COUNT', '');
  setConfig('TICKET_PROCESS_INDEX', '');
}
