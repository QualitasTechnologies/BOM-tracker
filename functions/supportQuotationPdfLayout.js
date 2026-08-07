const PAGE_LEFT = 42;
const PAGE_RIGHT = 553;
const PAGE_WIDTH = PAGE_RIGHT - PAGE_LEFT;

const getBillingEntityDisplayName = (billingEntity = {}) =>
  String(billingEntity.displayName || billingEntity.legalName || 'Company').trim();

const textHeight = (doc, text, options) =>
  text ? doc.heightOfString(String(text), options) : 0;

const drawSupportQuotationHeader = ({
  doc,
  billingEntity,
  client = {},
  project = {},
  ticket = {},
  projectId,
  ticketId,
  quotationNumber,
  quotationDateText,
  validUntilText,
  hasLogo = false,
}) => {
  const entityName = getBillingEntityDisplayName(billingEntity);
  const headerX = hasLogo ? 175 : PAGE_LEFT;
  const headerWidth = hasLogo ? PAGE_RIGHT - headerX : PAGE_WIDTH;
  const headerAlign = hasLogo ? 'right' : 'left';
  const nameY = 42;

  doc.font('Helvetica-Bold').fontSize(17);
  const nameHeight = textHeight(doc, entityName, {width: headerWidth});
  doc.fillColor('#0f172a').text(entityName, headerX, nameY, {
    width: headerWidth,
    align: headerAlign,
  });

  const address = String(billingEntity.companyAddress || '').trim();
  const addressY = nameY + nameHeight + 4;
  doc.font('Helvetica').fontSize(8);
  const addressHeight = textHeight(doc, address, {width: headerWidth});
  if (address) {
    doc.fillColor('#475569').text(address, headerX, addressY, {
      width: headerWidth,
      align: headerAlign,
    });
  }

  const legalIdentifiers = [
    billingEntity.gstin ? `GSTIN: ${billingEntity.gstin}` : '',
    billingEntity.pan ? `PAN: ${billingEntity.pan}` : '',
    billingEntity.cin ? `CIN: ${billingEntity.cin}` : '',
    billingEntity.udyamRegistrationNumber
      ? `Udyam: ${billingEntity.udyamRegistrationNumber}`
      : '',
  ].filter(Boolean).join('  |  ');
  const contactIdentifiers = [
    billingEntity.stateName
      ? `State: ${billingEntity.stateName}${billingEntity.stateCode ? ` (${billingEntity.stateCode})` : ''}`
      : '',
    billingEntity.phone ? `Tel: ${billingEntity.phone}` : '',
    billingEntity.fax ? `Fax: ${billingEntity.fax}` : '',
    billingEntity.email ? `Email: ${billingEntity.email}` : '',
    billingEntity.website ? `Web: ${billingEntity.website}` : '',
  ].filter(Boolean).join('  |  ');

  const identityY = Math.max(
    hasLogo ? 92 : nameY,
    addressY + addressHeight,
  ) + 7;
  doc.font('Helvetica').fontSize(8);
  const identityHeight = textHeight(doc, legalIdentifiers, {width: PAGE_WIDTH});
  if (legalIdentifiers) {
    doc.fillColor('#475569').text(legalIdentifiers, PAGE_LEFT, identityY, {
      width: PAGE_WIDTH,
      align: 'right',
    });
  }

  const contactY = identityY + identityHeight + (contactIdentifiers ? 3 : 0);
  const contactHeight = textHeight(doc, contactIdentifiers, {width: PAGE_WIDTH});
  if (contactIdentifiers) {
    doc.fillColor('#475569').text(contactIdentifiers, PAGE_LEFT, contactY, {
      width: PAGE_WIDTH,
      align: 'right',
    });
  }

  const dividerY = Math.max(
    identityY + identityHeight,
    contactY + contactHeight,
  ) + 8;
  doc.moveTo(PAGE_LEFT, dividerY).lineTo(PAGE_RIGHT, dividerY)
    .strokeColor('#cbd5e1').stroke();

  const titleY = dividerY + 16;
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#0f172a')
    .text('SERVICE QUOTATION', PAGE_LEFT, titleY);
  doc.fontSize(10).text(quotationNumber, PAGE_LEFT, titleY + 29);
  doc.font('Helvetica').fontSize(9).fillColor('#475569')
    .text(`Date: ${quotationDateText}`, 393, titleY + 4, {width: 160, align: 'right'})
    .text(`Valid until: ${validUntilText}`, 393, titleY + 20, {width: 160, align: 'right'});

  const partyY = titleY + 52;
  const leftX = 54;
  const leftWidth = 235;
  const rightX = 310;
  const rightWidth = 230;
  const sectionLabelY = partyY + 12;
  const contentY = partyY + 28;
  const clientName = project.clientName || client.company || ticket.clientName || 'Customer';

  doc.font('Helvetica-Bold').fontSize(11);
  const clientNameHeight = textHeight(doc, clientName, {width: leftWidth});
  const clientAddress = String(client.address || '').trim();
  doc.font('Helvetica').fontSize(8);
  const clientAddressY = contentY + clientNameHeight + 4;
  const clientAddressHeight = textHeight(doc, clientAddress, {width: leftWidth});
  const clientIdentifiers = [
    client.gstin ? `GSTIN: ${client.gstin}` : 'GSTIN: Not provided',
    client.pan ? `PAN: ${client.pan}` : '',
  ].filter(Boolean).join('  |  ');
  const clientIdentifiersY = clientAddressY + clientAddressHeight + 5;
  const clientIdentifiersHeight = textHeight(doc, clientIdentifiers, {width: leftWidth});
  const clientState = client.stateName
    ? `State: ${client.stateName}${client.stateCode ? ` (${client.stateCode})` : ''}`
    : '';
  const clientStateY = clientIdentifiersY + clientIdentifiersHeight + (clientState ? 3 : 0);
  const clientStateHeight = textHeight(doc, clientState, {width: leftWidth});

  const supportReference = `${ticket.ticketNumber || ticketId} | ${project.projectName || projectId}`;
  const machineReference = `${ticket.machineName || 'Machine not tagged'}${ticket.machineSerialNumber ? ` | S/N ${ticket.machineSerialNumber}` : ''}`;
  doc.font('Helvetica').fontSize(9);
  const supportReferenceHeight = textHeight(doc, supportReference, {width: rightWidth});
  const machineReferenceY = contentY + supportReferenceHeight + 4;
  const machineReferenceHeight = textHeight(doc, machineReference, {width: rightWidth});

  const partyContentBottom = Math.max(
    clientStateY + clientStateHeight,
    machineReferenceY + machineReferenceHeight,
  );
  const partyHeight = Math.max(94, partyContentBottom - partyY + 12);

  doc.roundedRect(PAGE_LEFT, partyY, PAGE_WIDTH, partyHeight, 4)
    .fillAndStroke('#f8fafc', '#e2e8f0');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b')
    .text('QUOTATION TO', leftX, sectionLabelY)
    .text('SUPPORT REFERENCE', rightX, sectionLabelY);
  doc.fontSize(11).fillColor('#0f172a').text(clientName, leftX, contentY, {width: leftWidth});
  doc.font('Helvetica').fontSize(8).fillColor('#475569');
  if (clientAddress) {
    doc.text(clientAddress, leftX, clientAddressY, {width: leftWidth});
  }
  doc.text(clientIdentifiers, leftX, clientIdentifiersY, {width: leftWidth});
  if (clientState) {
    doc.text(clientState, leftX, clientStateY, {width: leftWidth});
  }
  doc.font('Helvetica').fontSize(9).fillColor('#0f172a')
    .text(supportReference, rightX, contentY, {width: rightWidth})
    .text(machineReference, rightX, machineReferenceY, {width: rightWidth});

  return partyY + partyHeight + 17;
};

module.exports = {
  drawSupportQuotationHeader,
  getBillingEntityDisplayName,
};
