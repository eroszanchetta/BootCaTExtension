// ZIP contents are rebuilt after a user changes document inclusion.
export function corpusFiles(documents) {
  return documents.filter(doc => doc.extraction.status === 'ok' && doc.extraction.included)
    .map(doc => ({ name: doc.textFilename, data: doc.extraction.text + '\n' }));
}
export function extractionMetadata(documents) {
  return documents.map(doc => {
    const { text, ...metadata } = doc.extraction;
    return { url: doc.url, ...(doc.source ? { source: doc.source, captureId: doc.captureId, capturedAt: doc.capturedAt } : {}), originalFilename: doc.filename, textFilename: metadata.status === 'ok' && metadata.included ? doc.textFilename : null, ...metadata };
  });
}
