const test = require('node:test');
const assert = require('node:assert/strict');
const {
  drawSupportQuotationHeader,
  getBillingEntityDisplayName,
} = require('./supportQuotationPdfLayout');

class MeasuringDocument {
  constructor() {
    this.fontSizeValue = 12;
    this.textCalls = [];
  }

  font() { return this; }
  fontSize(value) { this.fontSizeValue = value; return this; }
  fillColor() { return this; }
  strokeColor() { return this; }
  moveTo() { return this; }
  lineTo() { return this; }
  stroke() { return this; }
  roundedRect() { return this; }
  fillAndStroke() { return this; }

  heightOfString(value, {width = 500} = {}) {
    const charactersPerLine = Math.max(1, Math.floor(width / (this.fontSizeValue * 0.52)));
    const lines = Math.max(1, Math.ceil(String(value).length / charactersPerLine));
    return lines * this.fontSizeValue * 1.15;
  }

  text(value, x, y, options = {}) {
    this.textCalls.push({value: String(value), x, y, options, fontSize: this.fontSizeValue});
    return this;
  }
}

const baseInput = (doc, address) => ({
  doc,
  billingEntity: {
    displayName: 'Qualitas Technologies',
    legalName: 'Technologies',
    companyAddress: address,
    gstin: '29AAACQ1872F1ZE',
    pan: 'AAACQ1872F',
    stateName: 'Karnataka',
    stateCode: '29',
  },
  client: {company: 'JK Tyre', address: 'Mysuru', stateName: 'Karnataka', stateCode: '29'},
  project: {projectName: 'Thickness measurement system', clientName: 'JK Tyre'},
  ticket: {ticketNumber: 'SUP-001', machineName: 'Machine 1', machineSerialNumber: 'SN-001'},
  projectId: 'PRJ-003',
  ticketId: 'ticket-1',
  quotationNumber: 'SVC/26-27/0001',
  quotationDateText: '2026-08-07',
  validUntilText: '2026-09-06',
  hasLogo: true,
});

test('prefers the configured billing entity display name', () => {
  assert.equal(
    getBillingEntityDisplayName({displayName: 'Qualitas Technologies', legalName: 'Technologies'}),
    'Qualitas Technologies',
  );
});

test('moves identifiers and following sections below a wrapped address', () => {
  const shortDoc = new MeasuringDocument();
  const longDoc = new MeasuringDocument();
  const shortBottom = drawSupportQuotationHeader(baseInput(shortDoc, 'Bengaluru, Karnataka'));
  const longBottom = drawSupportQuotationHeader(baseInput(
    longDoc,
    'Registered Office: 53 Kempegowda Double Road, BEML Layout 5th Stage, Rajarajeshwarinagar, Bengaluru, Karnataka, India, 560098. Corporate correspondence address: same as registered office.',
  ));

  assert.ok(longBottom > shortBottom);
  assert.equal(longDoc.textCalls[0].value, 'Qualitas Technologies');

  const addressCall = longDoc.textCalls.find((call) => call.value.startsWith('Registered Office:'));
  const gstinCall = longDoc.textCalls.find((call) => call.value.startsWith('GSTIN:'));
  const addressHeight = longDoc.heightOfString(addressCall.value, {width: addressCall.options.width});
  assert.ok(gstinCall.y >= addressCall.y + addressHeight);
});
