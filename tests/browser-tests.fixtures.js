export const wordXML = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Caffè 中文 corpus.</w:t></w:r></w:p>
<w:p><w:r><w:t>Second </w:t></w:r><w:hyperlink><w:r><w:t>paragraph.</w:t></w:r></w:hyperlink><w:del><w:r><w:t>DELETED_SENTINEL</w:t></w:r></w:del><w:r><w:rPr><w:vanish/></w:rPr><w:t>HIDDEN_SENTINEL</w:t></w:r><w:r><w:instrText>FIELD_SENTINEL</w:instrText></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Left cell</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Right cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`;
export const docxFiles = [
  { name: '[Content_Types].xml', data: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
  { name: '_rels/.rels', data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
  { name: 'word/document.xml', data: wordXML }
];
export function pdfFixture({ empty = false, twoPages = false, javascript = false } = {}) {
  // Minimal valid PDF with offsets computed from its ASCII bytes.
  const text = 'BT /F1 12 Tf 50 750 Td (Renewable energy corpus.) Tj 0 -20 Td (Second line.) Tj ET';
  const stream = empty ? '' : text;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${javascript ? ' /OpenAction << /S /JavaScript /JS (globalThis.bootcatPDFScriptRan = true;) >>' : ''} >>`,
    `<< /Type /Pages /Kids [3 0 R${twoPages ? ' 6 0 R' : ''}] /Count ${twoPages ? 2 : 1} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ...(twoPages ? ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'] : [])
  ];
  let pdf = '%PDF-1.4\n', offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
