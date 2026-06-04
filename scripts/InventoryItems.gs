/**
 * InventoryItems.gs - Catalog reference loader.
 *
 * Pulls the full inventory catalog via POST /v1.0/inventory/items/query into
 * the InventoryItems sheet. Small dataset (typically a few thousand rows),
 * loaded in one pass during the initial load and refreshed weekly.
 */

function loadInventoryItems() {
  cacheConfigRowPositions();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('InventoryItems');
  if (!sheet) throw new Error('InventoryItems sheet not found.');

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }

  const pageSize = getPageSize();
  let page = 0;
  const allRows = [];

  while (true) {
    const payload = {
      Paging: {
        PageIndex: page,
        PageSize: pageSize,
        SortField: 'Name',
        SortDirection: 'Ascending'
      },
      Fields: ['Category']
    };
    const response = apiRequest('POST', '/v1.0/inventory/items/query', payload);
    const items = response && response.Items ? response.Items : [];
    if (items.length === 0) break;

    items.forEach(function(item) { allRows.push(mapInventoryItemRow_(item)); });

    if (response.Paging && response.Paging.PageCount !== undefined) {
      if (page + 1 >= response.Paging.PageCount) break;
    } else if (items.length < pageSize) {
      break;
    }
    page++;
  }

  if (allRows.length > 0) {
    sheet.getRange(2, 1, allRows.length, allRows[0].length).setValues(allRows);
  }
  logOperation('INVENTORY_ITEMS', 'SUCCESS', 'Loaded ' + allRows.length + ' catalog items.');
}

function mapInventoryItemRow_(item) {
  const category = item.Category || {};
  return [
    item.InventoryItemId || '',
    item.Name || '',
    item.ItemNumber || '',
    category.Name || '',
    category.CategoryId || '',
    typeof item.AverageCost === 'number' ? item.AverageCost : 0,
    typeof item.QuantityAvailable === 'number' ? item.QuantityAvailable : 0,
    typeof item.MinQuantityAvailable === 'number' ? item.MinQuantityAvailable : 0,
    item.TrackSupplier === true ? 'TRUE' : 'FALSE',
    item.TrackUnits === true ? 'TRUE' : 'FALSE',
    item.UseFixedCost === true ? 'TRUE' : 'FALSE',
    item.Description || '',
    parseApiDate(item.CreatedDate || ''),
    parseApiDate(item.ModifiedDate || '')
  ];
}
