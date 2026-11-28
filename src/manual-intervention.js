const labels = {
  'browser-capture': 'Added from browser', 'file-import': 'Imported file',
  'manual-text': 'Text supplied manually', 'text-edit': 'Text edited manually',
  'length-override': 'Length warning accepted', 'language-override': 'Language warning accepted', 'language-recheck': 'Language rechecked', 'inclusion-change': 'Inclusion changed manually'
};
export function manualActions(entry) {
  const actions = new Set((Array.isArray(entry.doc?.manualInterventions) ? entry.doc.manualInterventions : []).filter(value => Object.hasOwn(labels, value)));
  for (let record = entry.record; record; record = record.previousAttempt) {
    if (record.source === 'local-file') actions.add('file-import');
    else if (record.outcome === 'captured') actions.add('browser-capture');
  }
  if (entry.doc?.extraction?.recovery) actions.add('manual-text');
  else if (entry.doc?.editRevision > 0) actions.add('text-edit');
  if (entry.doc?.extraction?.languageCheck?.accepted) actions.add('language-override');
  return [...actions];
}
export function updateManualIndicator(indicator, entry) {
  if (!indicator) return;
  const actions = manualActions(entry), description = actions.map(value => labels[value]).join('; ');
  indicator.hidden = !actions.length;
  indicator.title = description; indicator.setAttribute('aria-label', description);
}
export function createManualIndicator(entry) {
  const indicator = document.createElement('span'); indicator.className = 'manual-intervention';
  indicator.setAttribute('role', 'img'); indicator.setAttribute('tabindex', '0');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'16',height:'16',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) svg.setAttribute(key,value);
  const path = document.createElementNS(svg.namespaceURI || 'http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d','M6 13V7a2 2 0 0 1 4 0v4M10 10V3a2 2 0 0 1 4 0v8M14 10V5a2 2 0 0 1 4 0v6M18 10V8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-1-6-3l-3.6-5.6a2 2 0 0 1 3.2-2.4L7 13');
  svg.append(path); indicator.append(svg); updateManualIndicator(indicator, entry); return indicator;
}
