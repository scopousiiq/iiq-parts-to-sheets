/**
 * Setup.gs - Sheet creation, headers, formulas, and protection.
 */

// --- Header constants (single source of truth for column counts) ---

const ACTIONS_HEADERS = [
  'InventoryActionId', 'ActionDate', 'ActionTypeId',
  'Quantity', 'QuantityAbs', 'UnitCost', 'TotalCost',
  'ItemId', 'ItemName', 'ItemNumber', 'CategoryName',
  'StockLocationId', 'StockLocationName',
  'TicketId', 'TicketNumber', 'TicketSubject',
  'PerformedByUserId', 'PerformedByUser',
  'Description', 'CreatedDate',
  // Ticket-context columns (denormalized inline from the Tickets sheet during write):
  'AssignedUser', 'AssignedTeam', 'TicketLocationName', 'IssueCategoryName', 'IssueTypeName'
];

const TICKETS_HEADERS = [
  'TicketId', 'TicketNumber', 'Subject', 'CreatedDate', 'ClosedDate',
  'AssignedUser', 'AssignedUserEmail', 'AssignedTeam', 'Location', 'Requester',
  'Status', 'IsClosed',
  'AssignedUserId', 'AssignedTeamId', 'LocationId',
  'IssueCategoryId', 'IssueCategoryName', 'IssueTypeId', 'IssueTypeName'
];

const ITEMS_HEADERS = [
  'InventoryItemId', 'Name', 'ItemNumber', 'CategoryName', 'CategoryId',
  'AverageCost', 'QuantityAvailable', 'MinQuantityAvailable',
  'TrackSupplier', 'TrackUnits', 'UseFixedCost',
  'Description', 'CreatedDate', 'ModifiedDate'
];

const FMT_DECIMAL = '#,##0.00';
const FMT_INTEGER = '#,##0';
const FMT_CURRENCY = '$#,##0.00';

function deleteSheetIfExists(ss, name) {
  const existing = ss.getSheetByName(name);
  if (existing) ss.deleteSheet(existing);
}

function setupPartsTrackerDashboard() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Setup iiQ Parts Tracker',
    '⚠️ WARNING: This will DELETE and RECREATE the following sheets:\n\n' +
    'DATA SHEETS:\n' +
    '- Instructions (setup guide)\n' +
    '- Config (API settings) - CREDENTIALS WILL BE LOST!\n' +
    '- DateFilters (date range)\n' +
    '- InventoryActions - ALL DATA WILL BE LOST!\n' +
    '- Tickets - ALL DATA WILL BE LOST!\n' +
    '- InventoryItems - ALL DATA WILL BE LOST!\n' +
    '- Logs (operations)\n\n' +
    'ANALYTICS SHEETS:\n' +
    '- Dashboard, ByCategory, ByItem, ByTeam, ByLocation, ByTicket, MonthlyTrend\n\n' +
    'This provides a CLEAN SLATE for the spreadsheet.\n\n' +
    'Are you sure you want to continue?',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  // Destructive op safety: rebuilding sheets while the monitor/daily
  // triggers are installed could collide with a run mid-rebuild.
  if (!requireNoTriggers('Run Complete Setup')) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const created = [];

  setupInstructionsSheet(ss); created.push('Instructions');
  setupConfigSheet(ss); created.push('Config');
  setupDateFiltersSheet(ss); created.push('DateFilters');
  setupActionsSheet(ss); created.push('InventoryActions');
  setupTicketsSheet(ss); created.push('Tickets');
  setupItemsSheet(ss); created.push('InventoryItems');
  setupByCategorySheet(ss); created.push('ByCategory');
  setupByItemSheet(ss); created.push('ByItem');
  setupByTeamSheet(ss); created.push('ByTeam');
  setupByLocationSheet(ss); created.push('ByLocation');
  setupByTicketSheet(ss); created.push('ByTicket');
  setupMonthlyTrendSheet(ss); created.push('MonthlyTrend');
  setupDashboardSheet(ss); created.push('Dashboard');
  setupLogsSheet(ss); created.push('Logs');

  reorderSheets_(ss);

  const lines = [];
  lines.push('Created ' + created.length + ' sheets: ' + created.join(', '));
  lines.push('');
  lines.push('Next steps:');
  lines.push('1. Fill in Config: API_BASE_URL, BEARER_TOKEN, SITE_ID, SCHOOL_YEAR_START, SCHOOL_YEAR_END');
  lines.push('2. Run iiQ Data > Setup > Test API Connection');
  lines.push('3. Run iiQ Data > Load Data > Start Initial Load');
  ui.alert('Setup Complete', lines.join('\n'), ui.ButtonSet.OK);
}

function reorderSheets_(ss) {
  const order = [
    'Instructions', 'Dashboard', 'DateFilters',
    'ByCategory', 'ByItem', 'ByTeam', 'ByLocation', 'ByTicket', 'MonthlyTrend',
    'InventoryActions', 'Tickets', 'InventoryItems',
    'Config', 'Logs'
  ];
  order.forEach(function(name, i) {
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      ss.setActiveSheet(sheet);
      ss.moveActiveSheet(i + 1);
    }
  });
}

// --- Instructions sheet ---
// Canonical Instructions Sheet Pattern (see workspace CANONICAL_PATTERNS.md):
// the primary end-user documentation, embedded in the spreadsheet itself.

function setupInstructionsSheet(ss) {
  deleteSheetIfExists(ss, 'Instructions');

  const sheet = ss.insertSheet('Instructions');
  sheet.setColumnWidth(1, 700);
  sheet.setColumnWidth(2, 500);

  // --- Row builders ---
  var row = 1;

  function writeHeader(text) {
    sheet.getRange(row, 1).setValue(text).setFontWeight('bold').setFontSize(14);
    row++;
  }

  function writeSectionHeader(text) {
    sheet.getRange(row, 1).setValue(text).setFontWeight('bold').setFontSize(11);
    row++;
  }

  function writeLine(text) {
    sheet.getRange(row, 1).setValue(text);
    row++;
  }

  function writePair(col1, col2) {
    sheet.getRange(row, 1).setValue(col1);
    sheet.getRange(row, 2).setValue(col2);
    row++;
  }

  function writePairBold(col1, col2) {
    sheet.getRange(row, 1).setValue(col1).setFontWeight('bold');
    sheet.getRange(row, 2).setValue(col2);
    row++;
  }

  function blankRow() { row++; }

  // ===== TITLE / OVERVIEW =====
  writeHeader('iiQ PARTS TRACKER');
  writeLine('This spreadsheet pulls parts (inventory) usage and cost data from IncidentIQ into');
  writeLine('Google Sheets, providing rollup reports by category, item, team, location, and ticket.');
  writeLine('All analytics update automatically via formulas — no manual calculation needed.');
  blankRow();
  writeLine('Companion to iiq-tickets-to-sheets and iiq-labor-to-sheets — together they cover the');
  writeLine('tickets + labor + parts trio for full operating-cost reporting.');
  blankRow();

  // ===== QUICK START =====
  writeSectionHeader('QUICK START');
  writeLine('1. Run  iiQ Data > Setup > Run Complete Setup');
  writeLine('2. Go to the Config sheet and fill in:');
  writeLine('     API_BASE_URL  —  your district\'s IncidentIQ URL (e.g. https://district.incidentiq.com)');
  writeLine('     BEARER_TOKEN  —  your API bearer token (JWT) — obtain from iiQ: Admin > Developer Tools');
  writeLine('     SITE_ID  —  your site UUID');
  writeLine('     MODULE  —  choose Ticketing or Facilities from the dropdown');
  writeLine('     SCHOOL_YEAR_START / SCHOOL_YEAR_END  —  pre-filled with the current school year;');
  writeLine('         adjust if needed (YYYY-MM-DD format)');
  writeLine('3. Run  iiQ Data > Setup > Test API Connection  to verify credentials');
  writeLine('4. Run  iiQ Data > Load Data > Start Initial Load  to begin pulling data');
  writeLine('5. Wait for loading to complete (large datasets load in batches across multiple runs)');
  writeLine('6. (Optional) Run  iiQ Data > Setup > Setup Automated Triggers  for daily refresh');
  blankRow();

  // ===== HOW DATA LOADING WORKS =====
  writeSectionHeader('HOW DATA LOADING WORKS');
  writeLine('Data loads in three sequential groups:');
  writeLine('  Group 1:  Parts catalog (InventoryItems) — small, one pass');
  writeLine('  Group 2:  Tickets with parts usage (Tickets) — only tickets that consumed parts');
  writeLine('            in the school-year window, with team/location/issue context');
  writeLine('  Group 3:  Inventory actions (InventoryActions) — the parts consumption events,');
  writeLine('            pulled per ticket from Group 2 and tagged with ticket context');
  blankRow();
  writeLine('Google Apps Script has a 6-minute execution limit. Large loads automatically pause');
  writeLine('and resume. You can resume manually (iiQ Data > Load Data > Continue Loading) or');
  writeLine('let the automated monitor trigger pick it up every 10 minutes.');
  blankRow();
  writeLine('Progress is tracked in the Config sheet (TICKET_LOAD_PAGE, TICKET_PROCESS_INDEX).');
  writeLine('Use  iiQ Data > Check Status  to see current progress at any time.');
  blankRow();

  // ===== SHEET REFERENCE =====
  writeSectionHeader('SHEET REFERENCE');
  blankRow();
  writePairBold('Sheet', 'Description');
  writePair('Instructions', 'This sheet — setup guide and reference');
  writePair('Dashboard', 'KPI summary: total parts cost, qty used, action count, tickets with parts');
  writePair('DateFilters', 'Date range used by all analytics (defaults to the school year from Config)');
  writePair('ByCategory', 'Which part categories cost the most? Cost, qty, actions, tickets per category');
  writePair('ByItem', 'Which specific parts cost the most? Cost, qty, avg unit cost per item');
  writePair('ByTeam', 'Which teams consume the most parts? Cost, qty, tickets per assigned team');
  writePair('ByLocation', 'Which schools/buildings consume the most parts? Cost, qty, tickets per location');
  writePair('ByTicket', 'Which tickets were the most expensive? Parts cost, qty, actions per ticket');
  writePair('MonthlyTrend', 'How does parts spend change over the year? Cost, qty, actions per month');
  writePair('InventoryActions', 'Raw data: one row per parts consumption event (' + ACTIONS_HEADERS.length + ' columns)');
  writePair('Tickets', 'Ticket context for tickets with parts usage (' + TICKETS_HEADERS.length + ' columns)');
  writePair('InventoryItems', 'Parts catalog reference (' + ITEMS_HEADERS.length + ' columns)');
  writePair('Config', 'All settings, credentials, and load state (key-value pairs)');
  writePair('Logs', 'Operation log (newest first, auto-trimmed to 1000 rows)');
  blankRow();
  writeLine('InventoryActions includes only consumption events (parts used on tickets) — receipts,');
  writeLine('adjustments, and returns are excluded so cost rollups reflect actual usage.');
  blankRow();

  // ===== USING DATE FILTERS =====
  writeSectionHeader('USING DATE FILTERS');
  writeLine('All analytics sheets filter rows by the Start/End dates in DateFilters!B2 and C2.');
  writeLine('By default these are formulas reading SCHOOL_YEAR_START / SCHOOL_YEAR_END from Config.');
  blankRow();
  writeLine('To analyze a narrower window (e.g. one month), type dates directly into B2 and C2.');
  writeLine('To restore the school-year default, paste these formulas back into B2 and C2:');
  writeLine('  B2:  =IFERROR(VALUE(VLOOKUP("SCHOOL_YEAR_START",Config!A:B,2,FALSE)),"")');
  writeLine('  C2:  =IFERROR(VALUE(VLOOKUP("SCHOOL_YEAR_END",Config!A:B,2,FALSE)),"")');
  blankRow();

  // ===== MENU REFERENCE =====
  writeSectionHeader('MENU REFERENCE  (iiQ Data)');
  blankRow();
  writePairBold('Menu Item', 'What It Does');
  writePair('Check Status', 'Shows current load progress and data counts');
  writePair('View Dashboard', 'Navigates to the Dashboard sheet');
  blankRow();
  writeLine('  Setup submenu:');
  writePair('  Run Complete Setup', 'CLEAN SLATE: deletes and recreates ALL sheets — data and credentials are lost');
  writePair('  Regenerate Analytics Sheets', 'Rebuilds the formula sheets (ByCategory, ByItem, etc.) from scratch');
  writePair('  Test API Connection', 'Verifies API credentials work');
  writePair('  Verify Configuration', 'Checks all required Config settings are filled in');
  writePair('  Setup Automated Triggers', 'Installs monitor (10 min) and daily refresh (2 AM) triggers');
  writePair('  Remove Automated Triggers', 'Removes all time-based triggers');
  writePair('  View Trigger Status', 'Shows which triggers are currently installed');
  blankRow();
  writeLine('  Load Data submenu:');
  writePair('  Start Initial Load', 'Begins loading all data for the configured school year');
  writePair('  Continue Loading', 'Resumes a paused load from where it left off');
  writePair('  Refresh Inventory Items', 'Reloads the parts catalog (Group 1) on demand');
  blankRow();
  writeLine('  Troubleshooting submenu:');
  writePair('  View Logs', 'Navigates to the Logs sheet');
  writePair('  Reset Load States', 'Resets all load progress (does not delete data)');
  writePair('  Full Reload (Clear Data)', 'Deletes all data and unlocks school year — requires triggers removed first');
  blankRow();

  // ===== AUTOMATION =====
  writeSectionHeader('AUTOMATION');
  writeLine('Two automated triggers are available (install via iiQ Data > Setup > Setup Automated Triggers):');
  blankRow();
  writePairBold('Trigger', 'Schedule & Purpose');
  writePair('Data Load Monitor', 'Every 10 minutes — resumes any paused loads automatically');
  writePair('Daily Refresh', 'Daily at 2 AM — re-pulls tickets with parts and their inventory actions');
  blankRow();
  writeLine('Triggers skip gracefully if another operation is already running (no conflicts).');
  writeLine('The daily refresh only runs after the initial load is complete. The parts catalog');
  writeLine('(InventoryItems) is not refreshed automatically — use Refresh Inventory Items as needed.');
  blankRow();

  // ===== SCHOOL YEAR & DATA SCOPE =====
  writeSectionHeader('SCHOOL YEAR & DATA SCOPE');
  writeLine('Each spreadsheet holds one school year of data. The date range is set in Config:');
  writeLine('  SCHOOL_YEAR_START  and  SCHOOL_YEAR_END');
  blankRow();
  writeLine('Once data loading begins, the school year dates and Module are LOCKED to prevent accidental changes.');
  writeLine('To load a different school year:');
  writeLine('  1. Remove triggers  (iiQ Data > Setup > Remove Automated Triggers)');
  writeLine('  2. Full Reload  (iiQ Data > Troubleshooting > Full Reload) — clears all data and unlocks dates');
  writeLine('  3. Update SCHOOL_YEAR_START and SCHOOL_YEAR_END in Config');
  writeLine('  4. Start Initial Load');
  blankRow();
  writeLine('For multiple school years, make a copy of the spreadsheet and configure each with different dates.');
  blankRow();

  // ===== TROUBLESHOOTING =====
  writeSectionHeader('TROUBLESHOOTING');
  blankRow();
  writePairBold('Problem', 'Solution');
  writePair('Load seems stuck', 'Check Status. If paused, run Continue Loading or wait for the monitor trigger.');
  writePair('API connection fails', 'Verify API_BASE_URL (no /api suffix), BEARER_TOKEN, and SITE_ID in Config.');
  writePair('"Another operation is running"', 'Wait a few minutes. Locks auto-expire after 6 minutes.');
  writePair('Analytics show wrong data', 'Check DateFilters dates. Run Regenerate Analytics Sheets.');
  writePair('Analytics sheets are empty', 'InventoryActions must have data. Ensure all 3 load groups completed.');
  writePair('Need to change school year', 'Remove triggers first, then Full Reload to unlock and clear data.');
  writePair('Tickets load but no actions', 'Group 3 runs after Group 2 finishes — Check Status, then Continue Loading.');
  writePair('Quantities look doubled', 'Run Reset Load States, then Full Reload — a partial Group 3 may have re-appended.');
  blankRow();

  // ===== DASHBOARD INTEGRATION =====
  writeSectionHeader('DASHBOARD INTEGRATION  (Looker Studio / Power BI)');
  writeLine('Looker Studio:');
  writeLine('  1. In Looker Studio, choose Create > Data source > Google Sheets connector');
  writeLine('  2. Select this spreadsheet and the InventoryActions sheet (use first row as headers)');
  writeLine('  3. Build charts: scorecards from TotalCost/QuantityAbs, bar charts by CategoryName or');
  writeLine('     AssignedTeam, time series on ActionDate, tables by ItemName');
  writeLine('  4. Add the Tickets and InventoryItems sheets as extra data sources if needed');
  blankRow();
  writeLine('Power BI:');
  writeLine('  1. Share this spreadsheet (or publish to web as CSV) and use Get Data > Web,');
  writeLine('     or connect via a Google Sheets connector');
  writeLine('  2. Use InventoryActions as the fact table; Tickets and InventoryItems as dimensions');
  writeLine('     (join on TicketId and ItemId)');
  blankRow();
  writeLine('Tip: dashboards should read the raw data sheets, not the By* rollup sheets — BI tools');
  writeLine('do their own grouping, and the raw sheets carry every dimension column.');
  blankRow();

  // ===== TIPS =====
  writeSectionHeader('TIPS');
  writeLine('- The Logs sheet records every operation — check it first when debugging.');
  writeLine('- Config values are all strings. Don\'t change auto-managed keys manually.');
  writeLine('- Analytics sheets are formula-driven and update instantly when InventoryActions changes.');
  writeLine('- TotalCost = ABS(Quantity) x UnitCost, computed at load time per consumption event.');
  writeLine('- THROTTLE_MS (default 1000) controls delay between API calls. Lower = faster but may hit rate limits.');
  writeLine('- PAGE_SIZE (default 500) controls records per API call.');
  blankRow();

  // ===== SUPPORT =====
  writeSectionHeader('SUPPORT');
  writeLine('Source code, issues, and updates: github.com/scopousiiq/iiq-parts-to-sheets');
  writeLine('Companion projects: iiq-tickets-to-sheets, iiq-labor-to-sheets (same GitHub org)');
  writeLine('For API credential help, see your IncidentIQ administrator (Admin > Developer Tools).');
  blankRow();
  writeLine('Last updated: ' + new Date().toISOString().split('T')[0]);

  // Freeze row 1 for the title
  sheet.setFrozenRows(1);

  return true;
}

// --- Config sheet ---

function setupConfigSheet(ss) {
  deleteSheetIfExists(ss, 'Config');
  const sheet = ss.insertSheet('Config');

  // Pre-populate the school year with sensible defaults (June-based school
  // year, mirroring getSchoolYearRange()) so users see the expected format.
  const today = new Date();
  const startYear = today.getMonth() >= 5 ? today.getFullYear() : today.getFullYear() - 1;
  const defaultStart = formatDateISO(new Date(startYear, 5, 1));
  const defaultEnd = formatDateISO(new Date(startYear + 1, 4, 31));

  const rows = [
    ['Key', 'Value', 'Notes'],
    ['# API Configuration (Required)', '', ''],
    ['API_BASE_URL', 'https://your-district.incidentiq.com', 'Your IncidentIQ URL — base only, no /api suffix'],
    ['BEARER_TOKEN', '', 'API bearer token (JWT) — obtain from iiQ: Admin > Developer Tools'],
    ['SITE_ID', '', 'Site UUID'],
    ['MODULE', 'Ticketing', 'Choose from dropdown: Ticketing or Facilities'],
    ['', '', ''],
    ['# School Year (defaults to the current school year)', '', ''],
    ['SCHOOL_YEAR_START', defaultStart, 'Reporting period start (YYYY-MM-DD)'],
    ['SCHOOL_YEAR_END', defaultEnd, 'Reporting period end (YYYY-MM-DD)'],
    ['', '', ''],
    ['# Performance Settings (Optional)', '', ''],
    ['PAGE_SIZE', '500', 'Records per API call'],
    ['TICKET_BATCH_SIZE', '100', 'Tickets per ID-batch fetch'],
    ['THROTTLE_MS', '1000', 'Delay between API calls (ms)'],
    ['', '', ''],
    ['# Managed Automatically — do not edit', '', ''],
    ['LAST_SYNC', '', 'Last successful sync timestamp']
  ];
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#1f3a93').setFontColor('white');

  // Section header rows (start with '#'): bold on a light-blue band
  rows.forEach(function(r, i) {
    if (String(r[0]).indexOf('#') === 0) {
      sheet.getRange(i + 1, 1, 1, 3).setFontWeight('bold').setBackground('#e8f0fe');
    }
  });

  // Dropdown validation for MODULE
  const moduleRow = rows.findIndex(function(r) { return r[0] === 'MODULE'; }) + 1;
  const moduleRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Ticketing', 'Facilities'], true)
    .setHelpText('Ticketing = IT Ticketing module, Facilities = Facilities Ticketing module')
    .build();
  sheet.getRange(moduleRow, 2).setDataValidation(moduleRule);

  // Keep the pre-filled dates displaying as YYYY-MM-DD even if Sheets
  // coerces the strings to date values.
  const startRow = rows.findIndex(function(r) { return r[0] === 'SCHOOL_YEAR_START'; }) + 1;
  sheet.getRange(startRow, 2, 2, 1).setNumberFormat('yyyy-mm-dd');

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 360);
  sheet.setColumnWidth(3, 420);
  sheet.setFrozenRows(1);
  return true;
}

// --- DateFilters helper sheet ---

function setupDateFiltersSheet(ss) {
  deleteSheetIfExists(ss, 'DateFilters');
  const sheet = ss.insertSheet('DateFilters');
  sheet.getRange(1, 1, 1, 3).setValues([['Date Range', 'Start', 'End']]).setFontWeight('bold');
  sheet.getRange(2, 1, 1, 3).setValues([['This School Year', '', '']]);
  // Formula reads school-year start/end from Config:
  sheet.getRange('B2').setFormula('=IFERROR(VALUE(VLOOKUP("SCHOOL_YEAR_START",Config!A:B,2,FALSE)),"")');
  sheet.getRange('C2').setFormula('=IFERROR(VALUE(VLOOKUP("SCHOOL_YEAR_END",Config!A:B,2,FALSE)),"")');
  sheet.getRange(2, 2, 1, 2).setNumberFormat('yyyy-mm-dd');
  sheet.setFrozenRows(1);
  return true;
}

// --- Data sheets ---

function setupActionsSheet(ss) {
  deleteSheetIfExists(ss, 'InventoryActions');
  const sheet = ss.insertSheet('InventoryActions');
  sheet.getRange(1, 1, 1, ACTIONS_HEADERS.length).setValues([ACTIONS_HEADERS]);
  sheet.getRange(1, 1, 1, ACTIONS_HEADERS.length).setFontWeight('bold').setBackground('#1f3a93').setFontColor('white');
  sheet.setFrozenRows(1);
  // Number formats:
  sheet.getRange('B2:B').setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange('D2:E').setNumberFormat(FMT_INTEGER);
  sheet.getRange('F2:G').setNumberFormat(FMT_CURRENCY);
  sheet.getRange('T2:T').setNumberFormat('yyyy-mm-dd hh:mm');
  return true;
}

function setupTicketsSheet(ss) {
  deleteSheetIfExists(ss, 'Tickets');
  const sheet = ss.insertSheet('Tickets');
  sheet.getRange(1, 1, 1, TICKETS_HEADERS.length).setValues([TICKETS_HEADERS]);
  sheet.getRange(1, 1, 1, TICKETS_HEADERS.length).setFontWeight('bold').setBackground('#1f3a93').setFontColor('white');
  sheet.setFrozenRows(1);
  sheet.getRange('D2:E').setNumberFormat('yyyy-mm-dd hh:mm');
  return true;
}

function setupItemsSheet(ss) {
  deleteSheetIfExists(ss, 'InventoryItems');
  const sheet = ss.insertSheet('InventoryItems');
  sheet.getRange(1, 1, 1, ITEMS_HEADERS.length).setValues([ITEMS_HEADERS]);
  sheet.getRange(1, 1, 1, ITEMS_HEADERS.length).setFontWeight('bold').setBackground('#1f3a93').setFontColor('white');
  sheet.setFrozenRows(1);
  sheet.getRange('F2:F').setNumberFormat(FMT_CURRENCY);
  sheet.getRange('G2:H').setNumberFormat(FMT_INTEGER);
  return true;
}

// --- Analytics sheets (default set) ---
// All use IFERROR + LET/BYROW so they tolerate empty data. Filter by ActionDate
// against DateFilters!B2..C2 (defaults to school year). All reference NAME
// columns for grouping (per CANONICAL_PATTERNS).

function setupByCategorySheet(ss) {
  deleteSheetIfExists(ss, 'ByCategory');
  const sheet = ss.insertSheet('ByCategory');
  const headers = ['Category', 'Total Cost', 'Quantity Used', 'Action Count', 'Unique Tickets'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange('A2').setFormula(byCategoryFormula_());
  sheet.getRange('B2:B').setNumberFormat(FMT_CURRENCY);
  sheet.getRange('C2:E').setNumberFormat(FMT_INTEGER);
  return true;
}

function byCategoryFormula_() {
  // K = CategoryName, G = TotalCost, E = QuantityAbs, N = TicketId, B = ActionDate
  return '=IFERROR(LET(' +
    'src,InventoryActions!K2:K,' +
    'cats,UNIQUE(FILTER(src,src<>"")),' +
    'cost,BYROW(cats,LAMBDA(c,SUMIFS(InventoryActions!G:G,InventoryActions!K:K,c,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'qty,BYROW(cats,LAMBDA(c,SUMIFS(InventoryActions!E:E,InventoryActions!K:K,c,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'count,BYROW(cats,LAMBDA(c,COUNTIFS(InventoryActions!K:K,c,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'tickets,BYROW(cats,LAMBDA(c,IFERROR(ROWS(UNIQUE(FILTER(InventoryActions!N2:N,InventoryActions!K2:K=c,InventoryActions!B2:B>=DateFilters!B2,InventoryActions!B2:B<=DateFilters!C2))),0))),' +
    'IFERROR(SORT(HSTACK(cats,cost,qty,count,tickets),2,FALSE),HSTACK(cats,cost,qty,count,tickets))' +
    '),"No data")';
}

function setupByItemSheet(ss) {
  deleteSheetIfExists(ss, 'ByItem');
  const sheet = ss.insertSheet('ByItem');
  const headers = ['Item Name', 'Category', 'Total Cost', 'Quantity Used', 'Avg Unit Cost', 'Actions'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange('A2').setFormula(byItemFormula_());
  sheet.getRange('C2:C').setNumberFormat(FMT_CURRENCY);
  sheet.getRange('D2:D').setNumberFormat(FMT_INTEGER);
  sheet.getRange('E2:E').setNumberFormat(FMT_CURRENCY);
  sheet.getRange('F2:F').setNumberFormat(FMT_INTEGER);
  return true;
}

function byItemFormula_() {
  return '=IFERROR(LET(' +
    'src,InventoryActions!I2:I,' +
    'items,UNIQUE(FILTER(src,src<>"")),' +
    'cat,BYROW(items,LAMBDA(it,IFERROR(INDEX(InventoryActions!K:K,MATCH(it,InventoryActions!I:I,0)),""))),' +
    'cost,BYROW(items,LAMBDA(it,SUMIFS(InventoryActions!G:G,InventoryActions!I:I,it,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'qty,BYROW(items,LAMBDA(it,SUMIFS(InventoryActions!E:E,InventoryActions!I:I,it,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'avgCost,BYROW(items,LAMBDA(it,IFERROR(SUMIFS(InventoryActions!G:G,InventoryActions!I:I,it,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2)/SUMIFS(InventoryActions!E:E,InventoryActions!I:I,it,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2),0))),' +
    'actions,BYROW(items,LAMBDA(it,COUNTIFS(InventoryActions!I:I,it,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'IFERROR(SORT(HSTACK(items,cat,cost,qty,avgCost,actions),3,FALSE),HSTACK(items,cat,cost,qty,avgCost,actions))' +
    '),"No data")';
}

function setupByTeamSheet(ss) {
  deleteSheetIfExists(ss, 'ByTeam');
  const sheet = ss.insertSheet('ByTeam');
  const headers = ['Assigned Team', 'Total Cost', 'Quantity Used', 'Unique Tickets'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange('A2').setFormula(byTeamFormula_());
  sheet.getRange('B2:B').setNumberFormat(FMT_CURRENCY);
  sheet.getRange('C2:D').setNumberFormat(FMT_INTEGER);
  return true;
}

function byTeamFormula_() {
  // V = AssignedTeam (enriched column), G = TotalCost, E = QuantityAbs, N = TicketId
  return '=IFERROR(LET(' +
    'src,InventoryActions!V2:V,' +
    'teams,UNIQUE(FILTER(src,src<>"")),' +
    'cost,BYROW(teams,LAMBDA(t,SUMIFS(InventoryActions!G:G,InventoryActions!V:V,t,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'qty,BYROW(teams,LAMBDA(t,SUMIFS(InventoryActions!E:E,InventoryActions!V:V,t,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'tickets,BYROW(teams,LAMBDA(t,IFERROR(ROWS(UNIQUE(FILTER(InventoryActions!N2:N,InventoryActions!V2:V=t,InventoryActions!B2:B>=DateFilters!B2,InventoryActions!B2:B<=DateFilters!C2))),0))),' +
    'IFERROR(SORT(HSTACK(teams,cost,qty,tickets),2,FALSE),HSTACK(teams,cost,qty,tickets))' +
    '),"No data")';
}

function setupByLocationSheet(ss) {
  deleteSheetIfExists(ss, 'ByLocation');
  const sheet = ss.insertSheet('ByLocation');
  const headers = ['Ticket Location', 'Total Cost', 'Quantity Used', 'Unique Tickets'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange('A2').setFormula(byLocationFormula_());
  sheet.getRange('B2:B').setNumberFormat(FMT_CURRENCY);
  sheet.getRange('C2:D').setNumberFormat(FMT_INTEGER);
  return true;
}

function byLocationFormula_() {
  // W = TicketLocationName (enriched)
  return '=IFERROR(LET(' +
    'src,InventoryActions!W2:W,' +
    'locs,UNIQUE(FILTER(src,src<>"")),' +
    'cost,BYROW(locs,LAMBDA(l,SUMIFS(InventoryActions!G:G,InventoryActions!W:W,l,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'qty,BYROW(locs,LAMBDA(l,SUMIFS(InventoryActions!E:E,InventoryActions!W:W,l,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'tickets,BYROW(locs,LAMBDA(l,IFERROR(ROWS(UNIQUE(FILTER(InventoryActions!N2:N,InventoryActions!W2:W=l,InventoryActions!B2:B>=DateFilters!B2,InventoryActions!B2:B<=DateFilters!C2))),0))),' +
    'IFERROR(SORT(HSTACK(locs,cost,qty,tickets),2,FALSE),HSTACK(locs,cost,qty,tickets))' +
    '),"No data")';
}

function setupByTicketSheet(ss) {
  deleteSheetIfExists(ss, 'ByTicket');
  const sheet = ss.insertSheet('ByTicket');
  const headers = ['Ticket Number', 'Subject', 'Assigned Team', 'Total Parts Cost', 'Total Qty', 'Actions'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange('A2').setFormula(byTicketFormula_());
  sheet.getRange('D2:D').setNumberFormat(FMT_CURRENCY);
  sheet.getRange('E2:F').setNumberFormat(FMT_INTEGER);
  return true;
}

function byTicketFormula_() {
  // N = TicketId, O = TicketNumber, P = TicketSubject, V = AssignedTeam
  return '=IFERROR(LET(' +
    'src,InventoryActions!N2:N,' +
    'ids,UNIQUE(FILTER(src,src<>"",InventoryActions!B2:B>=DateFilters!B2,InventoryActions!B2:B<=DateFilters!C2)),' +
    'num,BYROW(ids,LAMBDA(i,IFERROR(INDEX(InventoryActions!O:O,MATCH(i,InventoryActions!N:N,0)),""))),' +
    'subj,BYROW(ids,LAMBDA(i,IFERROR(INDEX(InventoryActions!P:P,MATCH(i,InventoryActions!N:N,0)),""))),' +
    'team,BYROW(ids,LAMBDA(i,IFERROR(INDEX(InventoryActions!V:V,MATCH(i,InventoryActions!N:N,0)),""))),' +
    'cost,BYROW(ids,LAMBDA(i,SUMIFS(InventoryActions!G:G,InventoryActions!N:N,i,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'qty,BYROW(ids,LAMBDA(i,SUMIFS(InventoryActions!E:E,InventoryActions!N:N,i,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'actions,BYROW(ids,LAMBDA(i,COUNTIFS(InventoryActions!N:N,i,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2))),' +
    'IFERROR(SORT(HSTACK(num,subj,team,cost,qty,actions),4,FALSE),HSTACK(num,subj,team,cost,qty,actions))' +
    '),"No data")';
}

function setupMonthlyTrendSheet(ss) {
  deleteSheetIfExists(ss, 'MonthlyTrend');
  const sheet = ss.insertSheet('MonthlyTrend');
  const headers = ['Month', 'Total Cost', 'Quantity Used', 'Actions'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange('A2').setFormula(
    '=IFERROR(QUERY(' +
    '{ARRAYFORMULA(IF(InventoryActions!B2:B="","",TEXT(InventoryActions!B2:B,"YYYY-MM"))),InventoryActions!G2:G,InventoryActions!E2:E,InventoryActions!B2:B},' +
    '"select Col1, sum(Col2), sum(Col3), count(Col4) where Col1 is not null and Col4 >= date \'"&TEXT(DateFilters!B2,"YYYY-MM-DD")&"\' and Col4 <= date \'"&TEXT(DateFilters!C2,"YYYY-MM-DD")&"\' group by Col1 label sum(Col2) \'\', sum(Col3) \'\', count(Col4) \'\'",0),"No data")'
  );
  sheet.getRange('B2:B').setNumberFormat(FMT_CURRENCY);
  sheet.getRange('C2:D').setNumberFormat(FMT_INTEGER);
  return true;
}

function setupDashboardSheet(ss) {
  deleteSheetIfExists(ss, 'Dashboard');
  const sheet = ss.insertSheet('Dashboard');
  sheet.getRange('A1').setValue('iiQ Parts Tracker — Dashboard').setFontSize(18).setFontWeight('bold');
  sheet.getRange('A3').setValue('Date Range');
  sheet.getRange('B3').setFormula('=DateFilters!B2');
  sheet.getRange('C3').setValue('to');
  sheet.getRange('D3').setFormula('=DateFilters!C2');
  sheet.getRangeList(['B3', 'D3']).setNumberFormat('yyyy-mm-dd');

  // KPI tiles
  sheet.getRange('A5').setValue('Total Parts Cost').setFontWeight('bold');
  sheet.getRange('B5').setFormula('=IFERROR(SUMIFS(InventoryActions!G:G,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2),0)').setNumberFormat(FMT_CURRENCY);

  sheet.getRange('A6').setValue('Total Qty Used').setFontWeight('bold');
  sheet.getRange('B6').setFormula('=IFERROR(SUMIFS(InventoryActions!E:E,InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2),0)').setNumberFormat(FMT_INTEGER);

  sheet.getRange('A7').setValue('Action Count').setFontWeight('bold');
  sheet.getRange('B7').setFormula('=IFERROR(COUNTIFS(InventoryActions!B:B,">="&DateFilters!B2,InventoryActions!B:B,"<="&DateFilters!C2),0)').setNumberFormat(FMT_INTEGER);

  sheet.getRange('A8').setValue('Tickets With Parts').setFontWeight('bold');
  sheet.getRange('B8').setFormula(
    '=IFERROR(ROWS(UNIQUE(FILTER(InventoryActions!N2:N,InventoryActions!N2:N<>"",InventoryActions!B2:B>=DateFilters!B2,InventoryActions!B2:B<=DateFilters!C2))),0)'
  ).setNumberFormat(FMT_INTEGER);

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 180);
  return true;
}

function setupLogsSheet(ss) {
  deleteSheetIfExists(ss, 'Logs');
  const sheet = ss.insertSheet('Logs');
  sheet.getRange(1, 1, 1, 4).setValues([['Timestamp', 'Operation', 'Status', 'Details']]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return true;
}

// --- Regenerate analytics (idempotent) ---

function regenerateAnalyticsSheetsWithConfirm() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Regenerate Analytics Sheets',
    'This will delete and recreate the analytics sheets (ByCategory, ByItem, ByTeam, ByLocation, ByTicket, MonthlyTrend, Dashboard) with the latest formulas.\n\n' +
    'Data sheets (InventoryActions, Tickets, InventoryItems) are not affected.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Each setup function deletes its own sheet first (clean-slate builders).
  setupByCategorySheet(ss);
  setupByItemSheet(ss);
  setupByTeamSheet(ss);
  setupByLocationSheet(ss);
  setupByTicketSheet(ss);
  setupMonthlyTrendSheet(ss);
  setupDashboardSheet(ss);
  reorderSheets_(ss);
  ui.alert('Done', 'Analytics sheets regenerated.', ui.ButtonSet.OK);
}
