/**
 * Config.gs - Configuration, logging, concurrency, and type helpers for iiQ Parts Tracker
 */

const CONFIG_DEFAULTS = {
  'PAGE_SIZE': '500',
  'TICKET_BATCH_SIZE': '100',
  'THROTTLE_MS': '1000',
  'SCHOOL_YEAR_LOCKED': 'FALSE',
  'MODULE': 'Ticketing'
};

const CONFIG_REQUIRED = ['API_BASE_URL', 'BEARER_TOKEN', 'SITE_ID', 'SCHOOL_YEAR_START', 'SCHOOL_YEAR_END', 'MODULE'];

const PRODUCT_ID_MAP = {
  'Ticketing': '88df910c-91aa-e711-80c2-0004ffa00010',
  'Facilities': '88df910c-91aa-e711-80c2-0004ffa00020'
};

function getProductId() {
  const module = getStringValue(getConfig('MODULE')) || 'Ticketing';
  const id = PRODUCT_ID_MAP[module];
  if (!id) {
    throw new Error('Invalid MODULE value: "' + module + '". Must be Ticketing or Facilities.');
  }
  return id;
}

function getTicketBatchSize() {
  return getIntValue(getConfig('TICKET_BATCH_SIZE'), 100);
}

function getConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Config');
  if (!sheet) {
    throw new Error('Config sheet not found. Please run setup first.');
  }
  return sheet;
}

// --- Type Coercion Helpers ---

function getStringValue(val) {
  if (val === undefined || val === null || val === '') return '';
  if (val instanceof Date) return val.toISOString();
  return String(val).trim();
}

function getIntValue(val, defaultVal) {
  if (val === undefined || val === null || val === '') return defaultVal;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultVal : parsed;
}

function getBoolValue(val) {
  if (val === true || val === 'TRUE' || val === 'true') return true;
  return false;
}

// --- Config Read/Write ---

function getConfig(key) {
  const sheet = getConfigSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      const value = data[i][1];
      if (value !== '' && value !== null && value !== undefined) {
        return value;
      }
      break;
    }
  }

  if (Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS, key)) {
    return CONFIG_DEFAULTS[key];
  }

  return '';
}

function setConfig(key, value) {
  const sheet = getConfigSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(String(value));
      return;
    }
  }

  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, 1, 2).setValues([[key, String(value)]]);
}

// --- Config Caching (for tight loading loops) ---

let configRowCache_ = {};

function cacheConfigRowPositions() {
  const sheet = getConfigSheet();
  const data = sheet.getDataRange().getValues();
  configRowCache_ = {};
  data.forEach(function(row, i) {
    if (row[0]) configRowCache_[row[0]] = i + 1;
  });
}

function writeConfigValueDirect(key, value) {
  const sheet = getConfigSheet();
  const row = configRowCache_[key];
  if (row) {
    sheet.getRange(row, 2).setValue(String(value));
  } else {
    setConfig(key, value);
  }
}

function getConfigValueDirect(key) {
  const sheet = getConfigSheet();
  const row = configRowCache_[key];
  if (row) {
    const value = sheet.getRange(row, 2).getValue();
    if (value !== '' && value !== null && value !== undefined) {
      return value;
    }
  }
  if (Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS, key)) {
    return CONFIG_DEFAULTS[key];
  }
  return '';
}

function validateConfig() {
  const missing = [];
  CONFIG_REQUIRED.forEach(key => {
    const value = getConfig(key);
    if (!value) {
      missing.push(key);
    }
  });

  return {
    isValid: missing.length === 0,
    missing: missing
  };
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return '';
  let url = String(baseUrl).trim().replace(/\/+$/, '');
  if (!url.endsWith('/api')) {
    url = url + '/api';
  }
  return url;
}

function getApiUrl(endpoint) {
  const baseUrl = normalizeBaseUrl(getConfig('API_BASE_URL'));
  if (!baseUrl) {
    throw new Error('API_BASE_URL not configured.');
  }
  const cleanEndpoint = endpoint.replace(/^\/+/, '');
  return baseUrl + '/' + cleanEndpoint;
}

function getApiHeaders() {
  const token = getConfig('BEARER_TOKEN');
  const siteId = getConfig('SITE_ID');

  if (!token) {
    throw new Error('BEARER_TOKEN not configured.');
  }

  const headers = {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Client': 'ApiClient'
  };

  if (siteId) {
    headers['SiteId'] = siteId;
  }

  headers['ProductId'] = getProductId();

  return headers;
}

function getThrottleMs() {
  return getIntValue(getConfig('THROTTLE_MS'), 1000);
}

function getPageSize() {
  return getIntValue(getConfig('PAGE_SIZE'), 500);
}

function parseConfigDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value;
  }
  const str = getStringValue(value);
  if (!str) return null;
  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDateISO(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function parseApiDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? value : parsed;
}

function getSchoolYearRange() {
  const start = parseConfigDate(getConfig('SCHOOL_YEAR_START'));
  const end = parseConfigDate(getConfig('SCHOOL_YEAR_END'));

  if (!start || !end) {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const startYear = month >= 5 ? year : year - 1;
    const defaultStart = new Date(startYear, 5, 1);
    const defaultEnd = new Date(startYear + 1, 4, 31);
    return { startDate: defaultStart, endDate: defaultEnd };
  }

  return { startDate: start, endDate: end };
}

function getSchoolYearLabel() {
  const range = getSchoolYearRange();
  return range.startDate.getFullYear() + '-' + range.endDate.getFullYear();
}

function isSchoolYearLocked() {
  return getBoolValue(getConfig('SCHOOL_YEAR_LOCKED'));
}

function lockSchoolYearConfig() {
  if (isSchoolYearLocked()) return;

  const start = parseConfigDate(getConfig('SCHOOL_YEAR_START'));
  const end = parseConfigDate(getConfig('SCHOOL_YEAR_END'));
  if (!start || !end) {
    throw new Error('Cannot lock school year: start/end dates missing.');
  }

  const pageSize = getIntValue(getConfig('PAGE_SIZE'), 0);
  if (pageSize <= 0) {
    throw new Error('Cannot lock config: PAGE_SIZE is invalid.');
  }

  const module = getStringValue(getConfig('MODULE')) || 'Ticketing';

  setConfig('SCHOOL_YEAR_LOCKED', 'TRUE');
  setConfig('SCHOOL_YEAR_LOCKED_AT', new Date().toISOString());
  setConfig('SCHOOL_YEAR_LOCKED_START', formatDateISO(start));
  setConfig('SCHOOL_YEAR_LOCKED_END', formatDateISO(end));
  setConfig('PAGE_SIZE_LOCKED', String(pageSize));
  setConfig('MODULE_LOCKED', module);

  protectLockedConfigCells(true);
  logOperation('CONFIG', 'INFO', 'School year locked (Module: ' + module + ')');
}

function unlockSchoolYearConfig() {
  setConfig('SCHOOL_YEAR_LOCKED', 'FALSE');
  setConfig('SCHOOL_YEAR_LOCKED_AT', '');
  setConfig('SCHOOL_YEAR_LOCKED_START', '');
  setConfig('SCHOOL_YEAR_LOCKED_END', '');
  setConfig('PAGE_SIZE_LOCKED', '');
  setConfig('MODULE_LOCKED', '');

  protectLockedConfigCells(false);
  logOperation('CONFIG', 'INFO', 'School year unlocked');
}

function assertSchoolYearUnchanged() {
  if (!isSchoolYearLocked()) return;

  const lockedStartDate = parseConfigDate(getConfig('SCHOOL_YEAR_LOCKED_START'));
  const lockedEndDate = parseConfigDate(getConfig('SCHOOL_YEAR_LOCKED_END'));
  const lockedStart = lockedStartDate ? formatDateISO(lockedStartDate) : '';
  const lockedEnd = lockedEndDate ? formatDateISO(lockedEndDate) : '';
  const currentStart = formatDateISO(parseConfigDate(getConfig('SCHOOL_YEAR_START')));
  const currentEnd = formatDateISO(parseConfigDate(getConfig('SCHOOL_YEAR_END')));
  const lockedPageSize = getIntValue(getConfig('PAGE_SIZE_LOCKED'), -1);
  const currentPageSize = getIntValue(getConfig('PAGE_SIZE'), -1);

  if (lockedStart && lockedEnd && (lockedStart !== currentStart || lockedEnd !== currentEnd)) {
    throw new Error('School year is locked. Run a full reload to change the school year range.');
  }

  if (lockedPageSize > 0 && currentPageSize > 0 && lockedPageSize !== currentPageSize) {
    throw new Error('PAGE_SIZE is locked. Run a full reload to change PAGE_SIZE.');
  }

  const lockedModule = getStringValue(getConfig('MODULE_LOCKED'));
  const currentModule = getStringValue(getConfig('MODULE')) || 'Ticketing';
  if (lockedModule && lockedModule !== currentModule) {
    throw new Error('MODULE is locked. Run a full reload to change the module.');
  }
}

function ensureSchoolYearLocked() {
  if (!isSchoolYearLocked()) {
    lockSchoolYearConfig();
  }
}

function protectLockedConfigCells(shouldLock) {
  const sheet = getConfigSheet();
  const rows = findConfigRows(['SCHOOL_YEAR_START', 'SCHOOL_YEAR_END', 'PAGE_SIZE', 'MODULE']);
  if (rows.length === 0) return;

  if (shouldLock) {
    rows.forEach(row => {
      const range = sheet.getRange(row, 2);
      const protection = range.protect();
      protection.setDescription('Config Locked');
      protection.setWarningOnly(false);
    });
    return;
  }

  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  protections.forEach(protection => {
    if (protection.getDescription() === 'Config Locked') {
      protection.remove();
    }
  });
}

function findConfigRows(keys) {
  const sheet = getConfigSheet();
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (keys.indexOf(data[i][0]) !== -1) {
      rows.push(i + 1);
    }
  }
  return rows;
}

function logOperation(operation, status, details) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let logsSheet = ss.getSheetByName('Logs');

  if (!logsSheet) {
    logsSheet = ss.insertSheet('Logs');
    logsSheet.getRange(1, 1, 1, 4).setValues([['Timestamp', 'Operation', 'Status', 'Details']]);
    logsSheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  }

  const timestamp = new Date().toISOString();
  logsSheet.insertRowAfter(1);
  logsSheet.getRange(2, 1, 1, 4).setValues([[timestamp, operation, status, details]]);

  const totalRows = logsSheet.getLastRow();
  if (totalRows > 1001) {
    logsSheet.deleteRows(1002, totalRows - 1001);
  }
}

function updateLastSync() {
  setConfig('LAST_SYNC', new Date().toISOString());
}

// --- LockService Concurrency Control ---

function acquireScriptLock(waitMs) {
  waitMs = waitMs || 2000;
  try {
    const lock = LockService.getScriptLock();
    lock.waitLock(waitMs);
    return lock;
  } catch (e) {
    return null;
  }
}

function tryAcquireScriptLock(waitMs) {
  waitMs = waitMs || 1000;
  try {
    const lock = LockService.getScriptLock();
    lock.waitLock(waitMs);
    return lock;
  } catch (e) {
    return null;
  }
}

function releaseScriptLock(lock) {
  if (lock) {
    try { lock.releaseLock(); } catch (e) { /* already released */ }
  }
}

function showOperationBusyMessage(operationName) {
  try {
    SpreadsheetApp.getUi().alert(
      'Operation In Progress',
      'Another operation is currently running. ' +
      'Please wait for it to finish before running "' + operationName + '".',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    logOperation(operationName, 'SKIP', 'Another operation is running');
  }
}

// --- Destructive Operation Safety ---

function requireNoTriggers(operationName) {
  const triggers = ScriptApp.getProjectTriggers();
  if (triggers.length > 0) {
    SpreadsheetApp.getUi().alert(
      'Remove Triggers First',
      'The "' + operationName + '" operation requires all automated ' +
      'triggers to be removed first.\n\n' +
      'Go to: iiQ Data > Setup > Remove Automated Triggers',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return false;
  }
  return true;
}

function formatDateForApi(date) {
  const d = new Date(date);
  var month = String(d.getMonth() + 1);
  var day = String(d.getDate());
  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;
  return month + '/' + day + '/' + d.getFullYear();
}
