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
    'This will create all required sheets, headers, and formulas.\n\n' +
    'Existing sheets will not be overwritten.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const created = [];
  const skipped = [];

  function track(name, didCreate) {
    if (didCreate) created.push(name); else skipped.push(name);
  }

  track('Config', setupConfigSheet(ss));
  track('DateFilters', setupDateFiltersSheet(ss));
  track('InventoryActions', setupActionsSheet(ss));
  track('Tickets', setupTicketsSheet(ss));
  track('InventoryItems', setupItemsSheet(ss));
  track('ByCategory', setupByCategorySheet(ss));
  track('ByItem', setupByItemSheet(ss));
  track('ByTeam', setupByTeamSheet(ss));
  track('ByLocation', setupByLocationSheet(ss));
  track('ByTicket', setupByTicketSheet(ss));
  track('MonthlyTrend', setupMonthlyTrendSheet(ss));
  track('Dashboard', setupDashboardSheet(ss));
  track('Logs', setupLogsSheet(ss));

  reorderSheets_(ss);

  const lines = [];
  if (created.length) lines.push('Created: ' + created.join(', '));
  if (skipped.length) lines.push('Already existed: ' + skipped.join(', '));
  lines.push('');
  lines.push('Next steps:');
  lines.push('1. Fill in Config: API_BASE_URL, BEARER_TOKEN, SITE_ID, SCHOOL_YEAR_START, SCHOOL_YEAR_END');
  lines.push('2. Run iiQ Data > Setup > Test API Connection');
  lines.push('3. Run iiQ Data > Load Data > Start Initial Load');
  ui.alert('Setup Complete', lines.join('\n'), ui.ButtonSet.OK);
}

function reorderSheets_(ss) {
  const order = [
    'Dashboard', 'DateFilters',
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

// --- Config sheet ---

function setupConfigSheet(ss) {
  if (ss.getSheetByName('Config')) return false;
  const sheet = ss.insertSheet('Config');
  const rows = [
    ['Key', 'Value', 'Notes'],
    ['API_BASE_URL', '', 'e.g. https://district.incidentiq.com (no /api suffix)'],
    ['BEARER_TOKEN', '', 'Bearer JWT'],
    ['SITE_ID', '', 'Site UUID'],
    ['MODULE', 'Ticketing', 'Ticketing or Facilities'],
    ['SCHOOL_YEAR_START', '', 'Date — start of reporting period'],
    ['SCHOOL_YEAR_END', '', 'Date — end of reporting period'],
    ['PAGE_SIZE', '500', 'Records per API call'],
    ['TICKET_BATCH_SIZE', '100', 'Tickets per ID-batch fetch'],
    ['THROTTLE_MS', '1000', 'Delay between API calls (ms)'],
    ['LAST_SYNC', '', 'Auto-managed timestamp']
  ];
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#1f3a93').setFontColor('white');
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 360);
  sheet.setColumnWidth(3, 360);
  sheet.setFrozenRows(1);
  return true;
}

// --- DateFilters helper sheet ---

function setupDateFiltersSheet(ss) {
  if (ss.getSheetByName('DateFilters')) return false;
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
  if (ss.getSheetByName('InventoryActions')) return false;
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
  if (ss.getSheetByName('Tickets')) return false;
  const sheet = ss.insertSheet('Tickets');
  sheet.getRange(1, 1, 1, TICKETS_HEADERS.length).setValues([TICKETS_HEADERS]);
  sheet.getRange(1, 1, 1, TICKETS_HEADERS.length).setFontWeight('bold').setBackground('#1f3a93').setFontColor('white');
  sheet.setFrozenRows(1);
  sheet.getRange('D2:E').setNumberFormat('yyyy-mm-dd hh:mm');
  return true;
}

function setupItemsSheet(ss) {
  if (ss.getSheetByName('InventoryItems')) return false;
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
  if (ss.getSheetByName('ByCategory')) return false;
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
  if (ss.getSheetByName('ByItem')) return false;
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
  if (ss.getSheetByName('ByTeam')) return false;
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
  if (ss.getSheetByName('ByLocation')) return false;
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
  if (ss.getSheetByName('ByTicket')) return false;
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
  if (ss.getSheetByName('MonthlyTrend')) return false;
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
  if (ss.getSheetByName('Dashboard')) return false;
  const sheet = ss.insertSheet('Dashboard');
  sheet.getRange('A1').setValue('iiQ Parts Tracker — Dashboard').setFontSize(18).setFontWeight('bold');
  sheet.getRange('A3').setValue('Date Range');
  sheet.getRange('B3').setFormula('=DateFilters!B2');
  sheet.getRange('C3').setValue('to');
  sheet.getRange('D3').setFormula('=DateFilters!C2');
  sheet.getRange('B3:B3,D3:D3').setNumberFormat('yyyy-mm-dd');

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
  if (ss.getSheetByName('Logs')) return false;
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
  ['ByCategory', 'ByItem', 'ByTeam', 'ByLocation', 'ByTicket', 'MonthlyTrend', 'Dashboard'].forEach(function(name) {
    deleteSheetIfExists(ss, name);
  });
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
