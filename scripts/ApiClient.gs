/**
 * ApiClient.gs - HTTP client with retry/backoff for iiQ Parts Tracker
 */

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;

function apiRequest(method, endpoint, payload, retryCount) {
  retryCount = retryCount || 0;

  const validation = validateConfig();
  if (!validation.isValid) {
    throw new Error('API configuration missing: ' + validation.missing.join(', '));
  }

  const url = getApiUrl(endpoint);
  const headers = getApiHeaders();
  const throttleMs = getThrottleMs();

  const options = {
    method: method.toLowerCase(),
    headers: headers,
    muteHttpExceptions: true
  };

  if (payload && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.payload = JSON.stringify(payload);
  }

  try {
    if (throttleMs > 0) {
      Utilities.sleep(throttleMs);
    }

    const fetchStart = Date.now();
    const response = UrlFetchApp.fetch(url, options);
    const fetchMs = Date.now() - fetchStart;
    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code >= 200 && code < 300) {
      logOperation('API_REQUEST', 'SUCCESS', method + ' ' + endpoint + ' -> ' + code + ' (' + fetchMs + 'ms)');
      if (body && body.trim()) {
        try {
          return JSON.parse(body);
        } catch (parseError) {
          if (retryCount < MAX_RETRIES) {
            var backoffMs = BASE_BACKOFF_MS * Math.pow(2, retryCount) + Math.floor(Math.random() * 250);
            logOperation('API_REQUEST', 'PARSE_RETRY',
              method + ' ' + endpoint + ' -> ' + code + ' body truncated (' +
              body.length + ' bytes). Retry in ' + backoffMs + 'ms');
            Utilities.sleep(backoffMs);
            return apiRequest(method, endpoint, payload, retryCount + 1);
          }
          logOperation('API_REQUEST', 'ERROR',
            method + ' ' + endpoint + ' -> JSON parse failed after retries: ' + parseError.message);
          throw parseError;
        }
      }
      return null;
    }

    if ((code === 429 || code >= 500) && retryCount < MAX_RETRIES) {
      const backoffMs = BASE_BACKOFF_MS * Math.pow(2, retryCount) + Math.floor(Math.random() * 250);
      logOperation('API_REQUEST', 'RETRY',
        method + ' ' + endpoint + ' -> ' + code + ' (' + fetchMs + 'ms) retry in ' + backoffMs + 'ms');
      Utilities.sleep(backoffMs);
      return apiRequest(method, endpoint, payload, retryCount + 1);
    }

    logOperation('API_REQUEST', 'ERROR', method + ' ' + endpoint + ' -> ' + code + ' (' + fetchMs + 'ms): ' + body);
    throw new Error('API request failed (' + code + '): ' + body);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (retryCount < MAX_RETRIES && message.indexOf('fetch') !== -1) {
      const backoffMs = BASE_BACKOFF_MS * Math.pow(2, retryCount) + Math.floor(Math.random() * 250);
      logOperation('API_REQUEST', 'NETWORK_RETRY',
        method + ' ' + endpoint + ' -> ' + message + ' retry in ' + backoffMs + 'ms');
      Utilities.sleep(backoffMs);
      return apiRequest(method, endpoint, payload, retryCount + 1);
    }

    logOperation('API_REQUEST', 'ERROR', method + ' ' + endpoint + ': ' + message);
    throw error;
  }
}

function testApiConnection() {
  try {
    const response = apiRequest('POST', '/v1.0/inventory/items/query',
      { Paging: { PageIndex: 0, PageSize: 1 } });
    return !!response;
  } catch (error) {
    logOperation('API_TEST', 'ERROR', error.message);
    return false;
  }
}

function showApiTestResult() {
  const ui = SpreadsheetApp.getUi();
  const ok = testApiConnection();
  if (ok) {
    ui.alert('API Test Successful', 'Connected to Incident IQ API.', ui.ButtonSet.OK);
  } else {
    ui.alert('API Test Failed', 'Unable to connect. Check Config sheet and Logs.', ui.ButtonSet.OK);
  }
}
