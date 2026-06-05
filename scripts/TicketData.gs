/**
 * TicketData.gs - Primary loader: tickets that have parts usage in the
 * school-year window.
 *
 * Uses POST /v1.0/tickets with Facet="InventoryUsedDate" to scope the result
 * to only tickets that consumed parts during the configured date range. This
 * is the source of truth for which tickets we care about; the InventoryActions
 * loader (Group 3) drives off the TicketIds harvested here.
 *
 * Resumable across the 6-minute Apps Script execution limit via TICKET_LOAD_PAGE.
 */

const TICKETS_MAX_RUNTIME_MS = 5.5 * 60 * 1000;

function loadTicketsWithParts() {
  ensureSchoolYearLocked();
  assertSchoolYearUnchanged();
  cacheConfigRowPositions();

  const startTime = Date.now();
  const pageSize = getPageSize();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Tickets');
  if (!sheet) throw new Error('Tickets sheet not found.');

  setLoadState(DATA_LOAD_TYPES.TICKETS_WITH_PARTS, LOAD_STATES.IN_PROGRESS);

  let page = getIntValue(getConfig('TICKET_LOAD_PAGE'), 0);
  if (page < 0) page = 0;

  let firstTotalRows = getIntValue(getConfigValueDirect('TICKET_LOAD_FIRST_TOTAL_ROWS'), -1);
  let lastTotalRows = firstTotalRows;

  const range = getSchoolYearRange();

  while (true) {
    if (Date.now() - startTime >= TICKETS_MAX_RUNTIME_MS) {
      logOperation('TICKETS_WITH_PARTS', 'INFO', 'Paused due to time limit. Page ' + page);
      return;
    }

    const response = searchTicketsWithPartsPage_(range.startDate, range.endDate, page, pageSize);
    const items = response && response.Items ? response.Items : [];

    if (response && response.Paging && response.Paging.TotalRows !== undefined) {
      const currentTotalRows = response.Paging.TotalRows;
      if (firstTotalRows < 0) {
        firstTotalRows = currentTotalRows;
        writeConfigValueDirect('TICKET_LOAD_FIRST_TOTAL_ROWS', String(firstTotalRows));
      }
      lastTotalRows = currentTotalRows;
      writeConfigValueDirect('TICKET_LOAD_EXPECTED_COUNT', String(lastTotalRows));
    }

    if (items.length === 0) {
      finalizeTicketLoad_(sheet, firstTotalRows, lastTotalRows);
      return;
    }

    const rows = items.map(mapTicketRow_);
    writeTicketsPage_(sheet, page, pageSize, rows);

    page++;
    writeConfigValueDirect('TICKET_LOAD_PAGE', String(page));

    if (response && response.Paging && response.Paging.PageCount !== undefined) {
      if (page >= response.Paging.PageCount) {
        finalizeTicketLoad_(sheet, firstTotalRows, lastTotalRows);
        return;
      }
    }
  }
}

function finalizeTicketLoad_(sheet, firstTotalRows, lastTotalRows) {
  setLoadState(DATA_LOAD_TYPES.TICKETS_WITH_PARTS, LOAD_STATES.COMPLETE);
  writeConfigValueDirect('TICKET_LOAD_PAGE', '');
  const rowCount = Math.max(0, sheet.getLastRow() - 1);
  if (rowCount === 0) {
    // A 0-ticket result is usually a misconfigured window (future or
    // wrong-year dates match nothing), not a healthy load — make it loud.
    const range = getSchoolYearRange();
    logOperation('TICKETS_WITH_PARTS', 'WARNING',
      'Load complete but 0 tickets matched the window ' +
      formatDateISO(range.startDate) + ' to ' + formatDateISO(range.endDate) +
      '. If you expected data, check SCHOOL_YEAR_START / SCHOOL_YEAR_END in Config.');
    return;
  }
  logOperation('TICKETS_WITH_PARTS', 'SUCCESS',
    'Load complete. Rows: ' + rowCount + ', expected: ' + lastTotalRows +
    (firstTotalRows !== lastTotalRows ? ', drift: ' + (lastTotalRows - firstTotalRows) : ''));
}

function searchTicketsWithPartsPage_(startDate, endDate, page, pageSize) {
  // Sorted CreatedDate asc per workspace memory rule (stable bulk pagination).
  const sortExpr = encodeURIComponent('TicketCreatedDate asc');
  const payload = {
    ProductId: getProductId(),
    FilterByProduct: true,
    IncludeDeleted: false,
    Filters: [
      {
        Facet: 'InventoryUsedDate',
        Value: 'daterange:' + formatDateForApi(startDate) + '-' + formatDateForApi(endDate)
      }
    ]
  };
  const endpoint = '/v1.0/tickets?$p=' + page + '&$s=' + pageSize + '&$o=' + sortExpr;
  return apiRequest('POST', endpoint, payload);
}

function mapTicketRow_(t) {
  return [
    t.TicketId || '',
    t.TicketNumber || '',
    t.Subject || '',
    parseApiDate(t.CreatedDate || ''),
    parseApiDate(t.ClosedDate || ''),
    t.AssignedToUser ? t.AssignedToUser.Name || '' : '',
    t.AssignedToUser ? t.AssignedToUser.Email || '' : '',
    t.AssignedToTeam ? t.AssignedToTeam.TeamName || '' : '',
    t.Location ? t.Location.Name || '' : '',
    t.For ? t.For.Name || '' : '',
    t.WorkflowStep ? t.WorkflowStep.StatusName || '' : '',
    t.IsClosed === true ? 'Closed' : 'Open',
    t.AssignedToUserId || '',
    t.AssignedToTeamId || '',
    t.LocationId || '',
    t.Issue ? t.Issue.IssueCategoryId || '' : '',
    t.Issue ? t.Issue.IssueCategoryName || '' : '',
    t.Issue ? t.Issue.IssueTypeId || '' : '',
    t.Issue ? t.Issue.Name || '' : ''
  ];
}

function writeTicketsPage_(sheet, page, pageSize, rows) {
  const startRow = page * pageSize + 2;
  if (pageSize > 0) {
    sheet.getRange(startRow, 1, pageSize, sheet.getLastColumn()).clearContent();
  }
  if (rows.length > 0) {
    sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
  }
}

/**
 * Build a TicketId → context lookup from the Tickets sheet, used by
 * InventoryActions.gs to denormalize ticket fields onto each action row.
 */
function buildTicketContextMap() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Tickets');
  if (!sheet || sheet.getLastRow() < 2) return {};
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 19).getValues();
  const map = {};
  data.forEach(function(row) {
    const id = row[0];
    if (!id) return;
    map[id] = {
      ticketNumber: row[1] || '',
      subject: row[2] || '',
      assignedUser: row[5] || '',
      assignedTeam: row[7] || '',
      locationName: row[8] || '',
      issueCategoryName: row[16] || '',
      issueTypeName: row[18] || ''
    };
  });
  return map;
}
