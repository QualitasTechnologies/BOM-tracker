function purchaseOrderAcceptanceDate(acceptedAtMillis) {
  if (!Number.isSafeInteger(acceptedAtMillis) || acceptedAtMillis < 0) throw new TypeError('invalid accepted timestamp');
  const acceptedAt = new Date(acceptedAtMillis);
  const fields = new Map(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(acceptedAt).map(part => [part.type, part.value]));
  return {
    acceptedAt: acceptedAt.toISOString(),
    actualSentDate: `${fields.get('year')}-${fields.get('month')}-${fields.get('day')}`,
    sentAtMillis: acceptedAtMillis,
  };
}

module.exports = { purchaseOrderAcceptanceDate };
