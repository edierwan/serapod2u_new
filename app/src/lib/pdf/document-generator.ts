/**
 * Document PDF Generator with Digital Signatures
 * Generates signed PDFs for PO, Invoice, Payment, and Receipt documents
 */

import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';

// Types
export interface DocumentSignature {
  id: string;
  signer_user_id: string;
  signer_name: string;
  signer_role: string;
  signed_at: string;
  signature_image_url: string | null;
  signature_hash: string;
}

export interface DocumentData {
  id: string;
  doc_type: 'PO' | 'INVOICE' | 'PAYMENT' | 'RECEIPT';
  doc_no: string;
  status: string;
  order_id: string;
  company_id: string;
  issued_by_org_id: string;
  issued_to_org_id: string;
  payload: any;
  created_at: string;
}

export interface Company {
  id: string;
  org_name: string;
  org_code: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  phone?: string;
  email?: string;
  registration_no?: string;
}

export interface OrderData {
  id: string;
  order_no: string;
  order_type: string;
  total_amount: number;
  items: OrderItem[];
}

export interface OrderItem {
  product_code: string;
  product_name: string;
  variant_name: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

/**
 * Generate a signed PDF for a document
 */
export async function generateSignedPDF(
  document: DocumentData,
  order: OrderData,
  issuedBy: Company,
  issuedTo: Company,
  signatures: DocumentSignature[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 100, left: 50, right: 50 },
      info: {
        Title: `${document.doc_type} ${document.doc_no}`,
        Author: 'Serapod2u',
        Subject: `${document.doc_type} Document`,
        CreationDate: new Date(),
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      // Header
      renderHeader(doc, document.doc_type);

      // Document Info
      renderDocumentInfo(doc, document, order);

      // Parties
      renderParties(doc, issuedBy, issuedTo, document.doc_type);

      // Line Items
      renderLineItems(doc, order.items);

      // Summary/Totals
      renderSummary(doc, order);

      // Signatures Section
      renderSignatures(doc, signatures);

      // Footer
      renderFooter(doc, document);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Render PDF Header with Logo and Document Type
 */
function renderHeader(doc: PDFKit.PDFDocument, docType: string) {
  // Logo placeholder (add your logo file path)
  doc
    .fontSize(24)
    .font('Helvetica-Bold')
    .text('Serapod2u', 50, 50);

  doc
    .fontSize(18)
    .font('Helvetica-Bold')
    .text(getDocumentTitle(docType), 50, 80, { align: 'right' });

  doc.moveDown(2);
}

/**
 * Get document title based on type
 */
function getDocumentTitle(docType: string): string {
  switch (docType) {
    case 'PO':
      return 'PURCHASE ORDER';
    case 'INVOICE':
      return 'INVOICE';
    case 'PAYMENT':
      return 'PAYMENT ADVICE';
    case 'RECEIPT':
      return 'RECEIPT';
    default:
      return 'DOCUMENT';
  }
}

/**
 * Render Document Info (number, date, status)
 */
function renderDocumentInfo(doc: PDFKit.PDFDocument, document: DocumentData, order: OrderData) {
  const y = doc.y;
  const leftCol = 50;
  const rightCol = 350;

  doc.fontSize(10).font('Helvetica');

  // Left column
  doc
    .text(`${document.doc_type} No:`, leftCol, y, { continued: true })
    .font('Helvetica-Bold')
    .text(` ${document.doc_no}`);

  doc
    .font('Helvetica')
    .text(`Related Order:`, leftCol, doc.y + 5, { continued: true })
    .font('Helvetica-Bold')
    .text(` ${order.order_no}`);

  // Right column
  doc
    .font('Helvetica')
    .text(`Date:`, rightCol, y, { continued: true })
    .font('Helvetica-Bold')
    .text(` ${formatDate(document.created_at)}`);

  doc
    .font('Helvetica')
    .text(`Status:`, rightCol, doc.y + 5, { continued: true })
    .font('Helvetica-Bold')
    .text(` ${document.status.toUpperCase()}`);

  doc.moveDown(2);
}

/**
 * Render Parties (Issued By / Issued To)
 */
function renderParties(
  doc: PDFKit.PDFDocument,
  issuedBy: Company,
  issuedTo: Company,
  docType: string
) {
  const y = doc.y;
  const leftCol = 50;
  const rightCol = 300;
  const lineHeight = 12;

  // Left column - Issuer
  doc.fontSize(9).font('Helvetica-Bold');
  const issuerLabel = getIssuerLabel(docType);
  doc.text(issuerLabel, leftCol, y);

  doc.fontSize(8).font('Helvetica');
  doc.text(issuedBy.org_name, leftCol, doc.y + lineHeight);
  if (issuedBy.address_line1) doc.text(issuedBy.address_line1, leftCol, doc.y + lineHeight);
  if (issuedBy.city) {
    const address = `${issuedBy.city}, ${issuedBy.state || ''} ${issuedBy.postal_code || ''}`;
    doc.text(address, leftCol, doc.y + lineHeight);
  }
  if (issuedBy.phone) doc.text(`Phone: ${issuedBy.phone}`, leftCol, doc.y + lineHeight);
  if (issuedBy.email) doc.text(`Email: ${issuedBy.email}`, leftCol, doc.y + lineHeight);

  // Right column - Recipient
  doc.fontSize(9).font('Helvetica-Bold');
  const recipientLabel = getRecipientLabel(docType);
  doc.text(recipientLabel, rightCol, y);

  doc.fontSize(8).font('Helvetica');
  doc.text(issuedTo.org_name, rightCol, y + lineHeight + 9);
  if (issuedTo.address_line1) doc.text(issuedTo.address_line1, rightCol, doc.y + lineHeight);
  if (issuedTo.city) {
    const address = `${issuedTo.city}, ${issuedTo.state || ''} ${issuedTo.postal_code || ''}`;
    doc.text(address, rightCol, doc.y + lineHeight);
  }
  if (issuedTo.phone) doc.text(`Phone: ${issuedTo.phone}`, rightCol, doc.y + lineHeight);
  if (issuedTo.email) doc.text(`Email: ${issuedTo.email}`, rightCol, doc.y + lineHeight);

  doc.moveDown(3);
}

function getIssuerLabel(docType: string): string {
  switch (docType) {
    case 'PO':
      return 'BUYER (HQ)';
    case 'INVOICE':
      return 'ISSUED BY (SUPPLIER / MANUFACTURER)';
    case 'PAYMENT':
      return 'PAYER (HQ)';
    case 'RECEIPT':
      return 'RECEIVED FROM (PAYER / HQ)';
    default:
      return 'ISSUED BY';
  }
}

function getRecipientLabel(docType: string): string {
  switch (docType) {
    case 'PO':
      return 'SUPPLIER / MANUFACTURER';
    case 'INVOICE':
      return 'BILL TO (HQ)';
    case 'PAYMENT':
      return 'PAYEE (MANUFACTURER)';
    case 'RECEIPT':
      return 'RECEIVED BY (MANUFACTURER)';
    default:
      return 'ISSUED TO';
  }
}

/**
 * Render Line Items Table
 */
function renderLineItems(doc: PDFKit.PDFDocument, items: OrderItem[]) {
  const tableTop = doc.y;
  const tableHeaders = ['#', 'Product Code', 'Description', 'Qty', 'Unit Price', 'Line Total'];
  const colWidths = [30, 80, 180, 50, 70, 80];
  const colX = [50, 80, 160, 340, 390, 460];

  // Draw header
  doc.fontSize(9).font('Helvetica-Bold');
  tableHeaders.forEach((header, i) => {
    doc.text(header, colX[i], tableTop, { width: colWidths[i], align: i > 2 ? 'right' : 'left' });
  });

  // Draw header line
  doc
    .moveTo(50, tableTop + 15)
    .lineTo(540, tableTop + 15)
    .stroke();

  let y = tableTop + 20;

  // Draw rows
  doc.fontSize(8).font('Helvetica');
  items.forEach((item, index) => {
    if (y > 700) {
      doc.addPage();
      y = 50;
    }

    doc.text(String(index + 1), colX[0], y, { width: colWidths[0] });
    doc.text(item.product_code, colX[1], y, { width: colWidths[1] });
    doc.text(`${item.product_name} - ${item.variant_name}`, colX[2], y, {
      width: colWidths[2],
      ellipsis: true,
    });
    doc.text(String(item.qty), colX[3], y, { width: colWidths[3], align: 'right' });
    doc.text(formatCurrency(item.unit_price), colX[4], y, { width: colWidths[4], align: 'right' });
    doc.text(formatCurrency(item.line_total), colX[5], y, { width: colWidths[5], align: 'right' });

    y += 20;
  });

  // Bottom line
  doc
    .moveTo(50, y)
    .lineTo(540, y)
    .stroke();

  doc.y = y + 10;
}

/**
 * Render Summary/Totals
 */
function renderSummary(doc: PDFKit.PDFDocument, order: OrderData) {
  const tableLeft = 50;
  const tableRight = 540;
  const tableWidth = tableRight - tableLeft;
  const labelColumnWidth = tableWidth * 0.65;
  const valueColumnWidth = tableWidth - labelColumnWidth;
  const rowHeight = 18;

  let tableY = doc.y;

  const summaryRows = [
    { label: 'Subtotal', value: formatCurrency(order.total_amount) },
    { label: 'Discount / Campaign', value: formatCurrency(0) },
    { label: 'Tax (0%)', value: formatCurrency(0) },
  ];

  doc.fontSize(9).font('Helvetica');
  doc.lineWidth(0.5);
  doc.strokeColor('#b4b4b4');

  const totalTableHeight = rowHeight * summaryRows.length;
  doc.rect(tableLeft, tableY, tableWidth, totalTableHeight).stroke();

  // Vertical divider between label and value columns
  const valueColumnX = tableLeft + labelColumnWidth;
  doc.moveTo(valueColumnX, tableY)
    .lineTo(valueColumnX, tableY + totalTableHeight)
    .stroke();

  summaryRows.forEach((row, index) => {
    const rowY = tableY + index * rowHeight;

    if (index > 0) {
      doc.moveTo(tableLeft, rowY)
        .lineTo(tableRight, rowY)
        .stroke();
    }

    doc.font('Helvetica-Bold');
    doc.text(row.label, tableLeft + 6, rowY + 5, {
      width: labelColumnWidth - 12,
      align: 'left',
    });

    doc.font('Helvetica');
    doc.text(row.value, valueColumnX + 6, rowY + 5, {
      width: valueColumnWidth - 12,
      align: 'right',
    });
  });

  const spacingAfterTable = 8;
  let y = tableY + totalTableHeight + spacingAfterTable;

  const grandTotalHeight = 20;
  doc.save();
  doc.fillColor('#dcdcdc');
  doc.strokeColor('#646464');
  doc.rect(tableLeft, y, tableWidth, grandTotalHeight).fillAndStroke();
  doc.restore();
  doc.lineWidth(1);
  doc.strokeColor('#000000');
  doc.fillColor('black');

  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('GRAND TOTAL', tableLeft + 6, y + 6, {
    width: labelColumnWidth - 12,
    align: 'left',
  });

  doc.text(formatCurrency(order.total_amount), valueColumnX + 6, y + 6, {
    width: valueColumnWidth - 12,
    align: 'right',
  });

  doc.y = y + grandTotalHeight + 15;
}

/**
 * Render Signatures Section with Images and Details
 */
function renderSignatures(doc: PDFKit.PDFDocument, signatures: DocumentSignature[]) {
  if (!signatures || signatures.length === 0) {
    return;
  }

  // Check if we need a new page
  if (doc.y > 600) {
    doc.addPage();
  }

  const startY = doc.y + 20;

  // Section title
  doc
    .fontSize(12)
    .font('Helvetica-Bold')
    .text('SIGNATURES / APPROVAL TRAIL', 50, startY);

  doc
    .moveTo(50, startY + 20)
    .lineTo(540, startY + 20)
    .stroke();

  let y = startY + 30;

  signatures.forEach((signature, index) => {
    // Check if we need a new page for this signature
    if (y > 680) {
      doc.addPage();
      y = 50;
    }

    const sigBoxX = 50;
    const sigBoxWidth = 230;
    const sigBoxHeight = 90;

    // Draw signature box
    doc.rect(sigBoxX, y, sigBoxWidth, sigBoxHeight).stroke();

    // Signature label
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .text(`${index === 0 ? 'Acknowledged By' : 'Signed By'}:`, sigBoxX + 10, y + 12);

    // Signature image placeholder area
    const imageBoxY = y + 25;
    const imageBoxHeight = 35;
    doc.rect(sigBoxX + 10, imageBoxY, 120, imageBoxHeight).stroke();

    if (signature.signature_image_url) {
      // Placeholder text to indicate image would appear
      doc
        .fontSize(8)
        .font('Helvetica-Oblique')
        .text('Signature on file', sigBoxX + 15, imageBoxY + imageBoxHeight / 2 - 4);
    } else {
      doc
        .fontSize(8)
        .font('Helvetica-Oblique')
        .text('No signature image uploaded', sigBoxX + 15, imageBoxY + imageBoxHeight / 2 - 4);
    }

    // Signer details on the right
    const detailsX = sigBoxX + sigBoxWidth + 15;
    const detailWidth = 230;
    const detailLineHeight = 12;

    const addDetail = (label: string, value: string) => {
      doc
        .fontSize(8)
        .font('Helvetica')
        .text(`${label}:`, detailsX, y + 12, { continued: true })
        .font('Helvetica-Bold')
        .text(` ${value || '—'}`);
      y += detailLineHeight;
    };

    addDetail('Name', signature.signer_name);
    addDetail('Role', signature.signer_role);
    addDetail('Signed At', formatDateTime(signature.signed_at));
    addDetail('Integrity Hash', signature.signature_hash?.substring(0, 24) || '—');

    y = Math.max(y, imageBoxY + imageBoxHeight + 10);
    y += 10;
  });

  doc.y = y;
}

/**
 * Render Footer with Document Metadata
 */
function renderFooter(doc: PDFKit.PDFDocument, document: DocumentData) {
  const footerText = `Document ID: ${document.id.substring(0, 8)}... | Generated: ${formatDateTime(
    new Date().toISOString()
  )} | Serapod2u HQ | Confidential`;

  doc
    .fontSize(7)
    .font('Helvetica')
    .text(footerText, 50, 770, {
      align: 'center',
      width: 495,
    });
}

/**
 * Helper: Format date
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-MY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Helper: Format date and time
 */
function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-MY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Helper: Format currency
 */
function formatCurrency(amount: number): string {
  return `RM ${amount.toFixed(2)}`;
}

/**
 * Upload PDF to Supabase Storage
 */
export async function uploadSignedPDF(
  supabase: ReturnType<typeof createClient>,
  pdfBuffer: Buffer,
  documentType: string,
  documentId: string
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${documentType}/${documentId}/signed_${timestamp}.pdf`;

  const { data, error } = await supabase.storage
    .from('documents')
    .upload(fileName, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload PDF: ${error.message}`);
  }

  // Get public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from('documents').getPublicUrl(fileName);

  return publicUrl;
}
