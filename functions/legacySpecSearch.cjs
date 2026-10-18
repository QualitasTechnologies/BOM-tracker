const fault = code => Object.assign(new Error(code), { code });
const revision = snapshot => snapshot.exists && snapshot.updateTime
  ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : 'missing';

function createLegacySpecSearchHandler({ db, admin, fetch, logger, webhookUrl }) {
  return async (request, response) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.status(204).send('');
    if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed. Use POST.' });
    try {
      const { bomItemId, projectId, itemName, make, sku, userId } = request.body || {};
      if (!bomItemId || !projectId || !itemName) return response.status(400).json({ error: 'Missing required fields: bomItemId, projectId, itemName' });
      const projectRef = db.collection('projects').doc(projectId);
      const bomRef = projectRef.collection('bom').doc('data');
      const markerRef = db.collection('pulseMaterialCutovers').doc(projectId);
      const opening = await db.runTransaction(async tx => {
        const marker = await tx.get(markerRef);
        if (marker.exists) throw fault('material_cutover');
        const bom = await tx.get(bomRef);
        return { exists: bom.exists, version: revision(bom) };
      });
      await db.runTransaction(async tx => {
        const marker = await tx.get(markerRef);
        if (marker.exists) throw fault('material_cutover');
        const bom = await tx.get(bomRef);
        if (revision(bom) !== opening.version) throw fault('material_version_conflict');
      });
      const searchId = `spec-search-${bomItemId}-${Date.now()}`;
      const n8nResponse = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchId, bomItemId, projectId, itemName, make: make || '', sku: sku || '', userId: userId || 'system', timestamp: new Date().toISOString() }) });
      if (!n8nResponse.ok) {
        logger.error('n8n webhook error:', { status: n8nResponse.status });
        return response.status(500).json({ success: false, error: 'Failed to trigger spec search workflow' });
      }
      const n8nResult = await n8nResponse.json();
      if (n8nResult.success && n8nResult.specificationUrl && opening.exists) {
        try {
          await db.runTransaction(async tx => {
            const marker = await tx.get(markerRef);
            if (marker.exists) throw fault('material_cutover');
            const bom = await tx.get(bomRef);
            if (!bom.exists || revision(bom) !== opening.version) throw fault('material_version_conflict');
            const data = bom.data(), categories = Array.isArray(data.categories) ? data.categories : [];
            let updated = false;
            const nextCategories = categories.map(category => {
              if (updated || !Array.isArray(category.items)) return category;
              const index = category.items.findIndex(item => item?.id === bomItemId);
              if (index < 0) return category;
              updated = true;
              const items = [...category.items];
              items[index] = { ...items[index], specificationUrl: n8nResult.specificationUrl, updatedAt: new Date().toISOString() };
              return { ...category, items };
            });
            if (updated) tx.update(bomRef, { categories: nextCategories, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          });
          logger.info('Updated BOM item with spec URL', { bomItemId, specificationUrl: n8nResult.specificationUrl });
        } catch (error) {
          if (['material_cutover', 'material_version_conflict'].includes(error.code)) return response.status(409).json({ success: false, error: error.code });
          logger.error('Error updating Firestore:', error);
        }
      }
      return response.status(200).json({ success: true, searchId, status: 'completed', specificationUrl: n8nResult.specificationUrl || null,
        message: n8nResult.specificationUrl ? 'Spec sheet found and saved!' : 'Search completed but no spec sheet found.' });
    } catch (error) {
      if (error.code === 'material_cutover') return response.status(409).json({ success: false, error: error.code });
      logger.error('Error triggering spec search:', error);
      return response.status(500).json({ error: 'Internal server error', details: error.message });
    }
  };
}

module.exports = { createLegacySpecSearchHandler };
