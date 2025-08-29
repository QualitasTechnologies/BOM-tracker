/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest, onCall} = require("firebase-functions/v2/https");
const {onUserCreated} = require("firebase-functions/v2/identity");
const logger = require("firebase-functions/logger");
const fetch = require("node-fetch");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

// Define the OpenAI API Key as a secret
const openaiApiKeySecret = defineSecret('OPENAI_API_KEY');

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// Secure AI BOM Analysis Function
// This function acts as a proxy to OpenAI, keeping your API key secure on the server
exports.analyzeBOM = onRequest(
  { 
    secrets: [openaiApiKeySecret]
  },
  async (request, response) => {
  // Enable CORS for your frontend
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }

  // Only allow POST requests
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const { text, existingCategories } = request.body;

    // Validate input
    if (!text || typeof text !== 'string') {
      response.status(400).json({ error: 'Text content is required' });
      return;
    }

    // Get OpenAI API key from secrets (Firebase Functions v2)
    const openaiApiKey = openaiApiKeySecret.value();
    if (!openaiApiKey) {
      logger.error('OpenAI API key not configured in secrets');
      response.status(500).json({ error: 'AI service not configured - missing OPENAI_API_KEY secret' });
      return;
    }

    // Prepare the AI prompt
    const systemPrompt = `You are an expert BOM (Bill of Materials) analyst. Your task is to analyze BOM text and extract structured data.

EXISTING CATEGORIES: ${existingCategories?.join(', ') || 'None specified'}

ANALYSIS REQUIREMENTS:
1. Extract part names, quantities, and descriptions
2. Suggest appropriate categories based on part characteristics
3. Provide confidence scores (0.0 to 1.0) for each extraction
4. Handle various BOM formats (lists, tables, structured text)
5. Use existing categories when possible, suggest new ones when needed

OUTPUT FORMAT (JSON only, no other text):
{
  "items": [
    {
      "name": "Part name",
      "description": "Part description or specifications",
      "quantity": 1,
      "suggestedCategory": "Category name",
      "confidence": 0.95,
      "unit": "pcs"
    }
  ],
  "suggestedCategories": ["Category1", "Category2"],
  "totalItems": 5,
  "overallConfidence": 0.88
}

EXAMPLES:
- "Motor - 2" → name: "Motor", quantity: 2, category: "Motors & Drives"
- "Sensor 1" → name: "Sensor", quantity: 1, category: "Sensors"
- "Bracket (4)" → name: "Bracket", quantity: 4, category: "Mechanical"

Analyze the following BOM text:`;

    const userPrompt = `${text}

Please provide the analysis in the exact JSON format specified above.`;

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      })
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json().catch(() => ({}));
      logger.error('OpenAI API error:', errorData);
      response.status(openaiResponse.status).json({ 
        error: `AI service error: ${errorData.error?.message || 'Unknown error'}` 
      });
      return;
    }

    const data = await openaiResponse.json();
    const aiResponse = data.choices[0]?.message?.content;
    
    if (!aiResponse) {
      response.status(500).json({ error: 'No response from AI service' });
      return;
    }

    // Parse and validate the AI response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (parseError) {
      logger.error('Failed to parse AI response:', aiResponse);
      response.status(500).json({ error: 'Invalid response from AI service' });
      return;
    }

    // Validate response structure
    if (!parsedResponse.items || !Array.isArray(parsedResponse.items)) {
      response.status(500).json({ error: 'Invalid response format from AI service' });
      return;
    }

    // Transform and validate items
    const items = parsedResponse.items.map((item, index) => ({
      name: item.name || `Item ${index + 1}`,
      description: item.description || 'No description provided',
      quantity: parseInt(item.quantity) || 1,
      suggestedCategory: item.suggestedCategory || 'Uncategorized',
      confidence: Math.min(1.0, Math.max(0.0, parseFloat(item.confidence) || 0.5)),
      unit: item.unit || 'pcs'
    }));

    const suggestedCategories = parsedResponse.suggestedCategories || 
      [...new Set(items.map(item => item.suggestedCategory))];

    const result = {
      items,
      suggestedCategories,
      totalItems: items.length,
      confidence: parsedResponse.overallConfidence || 
        (items.length > 0 ? items.reduce((sum, item) => sum + item.confidence, 0) / items.length : 0),
      processingTime: Date.now() - Date.now() // Will be calculated by frontend
    };

    // Log successful analysis
    logger.info('BOM analysis completed successfully', {
      textLength: text.length,
      itemsCount: items.length,
      categories: suggestedCategories
    });

    response.status(200).json(result);

  } catch (error) {
    logger.error('Error in BOM analysis:', error);
    response.status(500).json({ 
      error: 'Internal server error during AI analysis' 
    });
  }
});

// Health check endpoint
exports.health = onRequest((request, response) => {
  response.set('Access-Control-Allow-Origin', '*');
  response.json({ 
    status: 'healthy', 
    service: 'BOM AI Analysis',
    timestamp: new Date().toISOString()
  });
});

// ==================== USER MANAGEMENT FUNCTIONS ====================

// Automatically set new users as 'pending' approval
exports.onUserCreated = onUserCreated(async (event) => {
  const { uid, email, displayName } = event.data;
  
  try {
    // Set initial custom claims - new users are pending approval
    await admin.auth().setCustomUserClaims(uid, {
      role: 'user',
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    logger.info('New user created with pending status', { uid, email });
    
    // Optional: Create a notification for admins about new user
    await admin.firestore().collection('userRequests').doc(uid).set({
      uid,
      email,
      displayName: displayName || '',
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
  } catch (error) {
    logger.error('Error setting up new user:', error);
  }
});

// Admin function to approve/reject users
exports.manageUserStatus = onCall(async (request) => {
  const { auth, data } = request;
  
  // Check if caller is authenticated
  if (!auth) {
    throw new Error('Authentication required');
  }
  
  // Get caller's custom claims to verify admin status
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  
  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new Error('Admin privileges required');
  }
  
  const { targetUid, action, role = 'user' } = data;
  
  if (!targetUid || !action) {
    throw new Error('targetUid and action are required');
  }
  
  try {
    let newClaims = {};
    
    switch (action) {
      case 'approve':
        newClaims = {
          role,
          status: 'approved',
          approvedAt: admin.firestore.FieldValue.serverTimestamp(),
          approvedBy: auth.uid
        };
        break;
        
      case 'reject':
        newClaims = {
          role: 'user',
          status: 'rejected',
          rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
          rejectedBy: auth.uid
        };
        break;
        
      case 'suspend':
        // Get current user claims for suspend action
        const targetRecord = await admin.auth().getUser(targetUid);
        newClaims = {
          ...targetRecord.customClaims,
          status: 'suspended',
          suspendedAt: admin.firestore.FieldValue.serverTimestamp(),
          suspendedBy: auth.uid
        };
        break;
        
      case 'updateRole':
        if (!['admin', 'user', 'viewer'].includes(role)) {
          throw new Error('Invalid role');
        }
        // Get current user claims for role update
        const targetRecordForRole = await admin.auth().getUser(targetUid);
        newClaims = {
          ...targetRecordForRole.customClaims,
          role,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: auth.uid
        };
        break;
        
      default:
        throw new Error('Invalid action');
    }
    
    // Update custom claims
    await admin.auth().setCustomUserClaims(targetUid, newClaims);
    
    // Update user request status if it exists
    if (action === 'approve' || action === 'reject') {
      await admin.firestore().collection('userRequests').doc(targetUid).update({
        status: action === 'approve' ? 'approved' : 'rejected',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedBy: auth.uid
      });
    }
    
    logger.info('User status updated successfully', {
      targetUid,
      action,
      role,
      adminUid: auth.uid
    });
    
    return { success: true, message: `User ${action}d successfully` };
    
  } catch (error) {
    logger.error('Error managing user status:', error);
    throw new Error(`Failed to ${action} user: ${error.message}`);
  }
});

// Get all pending user requests (admin only)
exports.getPendingUsers = onCall(async (request) => {
  const { auth } = request;
  
  if (!auth) {
    throw new Error('Authentication required');
  }
  
  // Verify admin status
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  
  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new Error('Admin privileges required');
  }
  
  try {
    const snapshot = await admin.firestore()
      .collection('userRequests')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .get();
    
    const pendingUsers = [];
    snapshot.forEach(doc => {
      pendingUsers.push({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate()
      });
    });
    
    return { users: pendingUsers };
    
  } catch (error) {
    logger.error('Error getting pending users:', error);
    throw new Error('Failed to get pending users');
  }
});

// Get all users with their roles (admin only)
exports.getAllUsers = onCall(async (request) => {
  const { auth } = request;
  
  if (!auth) {
    throw new Error('Authentication required');
  }
  
  // Verify admin status
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  
  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new Error('Admin privileges required');
  }
  
  try {
    const listUsersResult = await admin.auth().listUsers(1000); // Max 1000 users
    
    const users = listUsersResult.users.map(userRecord => ({
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName,
      photoURL: userRecord.photoURL,
      disabled: userRecord.disabled,
      lastSignInTime: userRecord.metadata.lastSignInTime,
      creationTime: userRecord.metadata.creationTime,
      customClaims: userRecord.customClaims || {}
    }));
    
    return { users };
    
  } catch (error) {
    logger.error('Error getting all users:', error);
    throw new Error('Failed to get users');
  }
});

// TEMPORARY: Bootstrap first admin (remove after initial setup)
exports.makeFirstAdmin = onCall(async (request) => {
  const { auth } = request;
  
  if (!auth) {
    throw new Error('Authentication required');
  }
  
  try {
    // Set the calling user as admin
    await admin.auth().setCustomUserClaims(auth.uid, {
      role: 'admin',
      status: 'approved',
      bootstrapped: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    logger.info('First admin bootstrapped', { uid: auth.uid });
    
    return { 
      success: true, 
      message: 'You have been set as the first admin. Please refresh the page.' 
    };
    
  } catch (error) {
    logger.error('Error bootstrapping admin:', error);
    throw new Error('Failed to bootstrap admin');
  }
});
