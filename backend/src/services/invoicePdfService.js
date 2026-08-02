const PDFDocument = require('pdfkit');

function generateInvoicePdf(invoice, stream) {
  const doc = new PDFDocument({ margin: 50 });

  doc.pipe(stream);

  // Header
  doc
    .fontSize(20)
    .text('INVOICE', { align: 'center' });

  doc.moveDown();

  // Company Info
  doc
    .fontSize(12)
    .text('ZedProcure', { align: 'left' })
    .text('Lusaka, Zambia', { align: 'left' });

  doc.moveDown(2);

  // Invoice Details
  const invoiceDate = new Date(invoice.created_at).toLocaleDateString();
  const dueDate = new Date(invoice.due_date).toLocaleDateString();
  doc
    .fontSize(10)
    .text(`Invoice Number: ${invoice.id}`)
    .text(`Invoice Date: ${invoiceDate}`)
    .text(`Due Date: ${dueDate}`)
    .text(`Status: ${invoice.status}`);

  doc.moveDown(2);

  // Line Items Table
  const tableTop = doc.y;
  const itemX = 50;
  const descriptionX = 150;
  const quantityX = 350;
  const priceX = 420;
  const totalX = 500;

  doc
    .fontSize(10)
    .text('Item', itemX, tableTop)
    .text('Description', descriptionX, tableTop)
    .text('Quantity', quantityX, tableTop)
    .text('Price', priceX, tableTop)
    .text('Total', totalX, tableTop);

  let i = 0;
  const invoice_items = invoice.line_items || [];
  for (const item of invoice_items) {
    const y = tableTop + 25 + (i * 25);
    doc
      .fontSize(10)
      .text(item.item, itemX, y)
      .text(item.description, descriptionX, y)
      .text(item.quantity, quantityX, y)
      .text(item.unit_price, priceX, y)
      .text(item.total_price, totalX, y);
    i++;
  }

  doc.moveDown(2);

  // Total
  doc
    .fontSize(12)
    .text(`Total: ${invoice.total_amount}`, { align: 'right' });

  doc.end();
}

module.exports = { generateInvoicePdf };
