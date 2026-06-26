// Shared CSV download helper. Each caller still builds its own CSV string
// (columns + cell-escaping are page-specific); this only centralizes the
// browser download mechanism: prepend a UTF-8 BOM (so Excel renders Arabic
// correctly) and trigger a download via a temporary <a>.
const BOM = '﻿';

export function downloadCsv(csvString, filename, type = 'text/csv;charset=utf-8;') {
  const blob = new Blob([BOM + csvString], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
