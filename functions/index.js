/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const functions = require("firebase-functions");
const {onRequest, onCall} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");
const pdfParse = require("pdf-parse");

// Use built-in fetch in Node.js 22
const fetch = globalThis.fetch;

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

// Define secrets
const openaiApiKeySecret = defineSecret('OPENAI_API_KEY');
const sendgridApiKey = defineSecret('SENDGRID_API_KEY');

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
functions.setGlobalOptions({ maxInstances: 10 });

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
    const { text, existingCategories, existingMakes, prompt } = request.body;

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

    // Use optimized prompt if provided, otherwise create an intelligent one
    const systemPrompt = prompt || `You are a BOM (Bill of Materials) extraction expert. Analyze the input text and extract items intelligently.

INTELLIGENCE RULES:
1. DETECT FORMAT: CSV, table, list, or structured text
2. For CSV: Parse columns correctly - identify which column contains what data
3. For your input like "1,XG-X2800,3D Controller - Inline 3D Image Processing System,KEYENCE,4,,,"85299090"
   - Column 1: Item number/sequence 
   - Column 2: Part number/SKU (XG-X2800)
   - Column 3: Description/Name (3D Controller - Inline 3D Image Processing System)  
   - Column 4: Manufacturer/Make (KEYENCE)
   - Column 5: Quantity (4)
   - Later columns: Additional info

EXTRACTION LOGIC:
- Use the LONGEST descriptive text as the item name
- Extract manufacturer/brand from dedicated columns or within text
- Match manufacturers to existing: ${existingMakes?.join(', ') || 'KEYENCE, Siemens, Omron, Allen Bradley, Schneider'}
- Categorize using: ${existingCategories?.join(', ') || 'Vision Systems, Control Systems, Motors & Drives, Sensors, Mechanical, Electrical'}
- For vision/camera equipment → "Vision Systems"
- For controllers/PLCs → "Control Systems"

STRICT JSON OUTPUT:
{
  "items": [
    {
      "name": "Primary item name (longest descriptive text)",
      "make": "Exact manufacturer name or null", 
      "description": "Full description",
      "sku": "Part number/model or null",
      "quantity": integer,
      "category": "Best matching category",
      "unit": "pcs"
    }
  ],
  "totalItems": number
}

CRITICAL: Return ONLY valid JSON. No explanation text.`;

    const userPrompt = `Extract BOM items from this text:

${text}`;

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
    const items = parsedResponse.items.map((item, index) => {
      // Clean and validate make field to prevent concatenation issues
      let cleanMake = undefined;
      if (item.make && typeof item.make === 'string') {
        // Remove any repeated patterns and trim
        cleanMake = item.make
          .replace(/(.+?)\1+/g, '$1') // Remove repeated patterns like "KEYENCEKEYENCE" -> "KEYENCE"
          .trim()
          .substring(0, 50); // Limit length to prevent UI issues
        
        // If empty after cleaning, set to undefined
        if (!cleanMake || cleanMake.length === 0) {
          cleanMake = undefined;
        }
      }

      return {
        name: item.name || `Item ${index + 1}`,
        make: cleanMake,
        description: item.description || item.name || 'No description provided',
        sku: item.sku || undefined,
        quantity: parseInt(item.quantity) || 1,
        category: item.category || 'Uncategorized',
        unit: item.unit || 'pcs',
        specifications: item.specifications || undefined
      };
    });

    const result = {
      items,
      totalItems: items.length,
      processingTime: 0 // Will be calculated by frontend
    };

    // Log successful analysis
    logger.info('BOM analysis completed successfully', {
      textLength: text.length,
      itemsCount: items.length,
      makesFound: items.filter(item => item.make).length
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

// One-time function to bootstrap the first admin user
exports.bootstrapAdmin = onCall(async (request) => {
  const { data } = request;
  const { email, adminKey } = data;
  
  // Simple security check - replace with your own secret
  if (adminKey !== 'QualitasTech2025Bootstrap') {
    throw new Error('Invalid admin key');
  }
  
  try {
    // Find user by email
    const userRecord = await admin.auth().getUserByEmail(email);
    
    // Set admin claims
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: 'admin',
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      bootstrapped: true
    });
    
    logger.info('Admin user bootstrapped', { uid: userRecord.uid, email });
    
    return { 
      success: true, 
      message: `Admin user ${email} has been approved`,
      uid: userRecord.uid
    };
    
  } catch (error) {
    logger.error('Error bootstrapping admin:', error);
    throw new Error(`Failed to bootstrap admin: ${error.message}`);
  }
});

// Setup new user after authentication (called from frontend)
exports.setupNewUser = onCall(async (request) => {
  const { auth } = request;
  
  if (!auth) {
    throw new Error('Authentication required');
  }
  
  try {
    const user = await admin.auth().getUser(auth.uid);
    
    // Check if user already has custom claims set
    if (user.customClaims && user.customClaims.role) {
      return { success: true, message: 'User already set up' };
    }
    
    // Check if user is from qualitastech.com domain for auto-approval
    const isQualitasUser = user.email && user.email.endsWith('@qualitastech.com');
    
    let userStatus = 'pending';
    let userRole = 'user';
    let message = 'User setup completed. Waiting for admin approval.';
    
    if (isQualitasUser) {
      userStatus = 'approved';
      message = 'User setup completed. Access granted automatically for Qualitas domain.';
      
      // Check if this is the first qualitastech user - make them admin
      const existingAdmins = await admin.auth().listUsers(1000);
      const hasAdmin = existingAdmins.users.some(u => 
        u.customClaims && u.customClaims.role === 'admin' && u.customClaims.status === 'approved'
      );
      
      if (!hasAdmin) {
        userRole = 'admin';
        message = 'User setup completed. First Qualitas user - granted admin access.';
      }
    }
    
    // Set custom claims based on domain
    await admin.auth().setCustomUserClaims(auth.uid, {
      role: userRole,
      status: userStatus,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      autoApproved: isQualitasUser
    });
    
    logger.info('New user created', { 
      uid: auth.uid, 
      email: user.email,
      role: userRole,
      status: userStatus,
      autoApproved: isQualitasUser
    });
    
    // Only create user request if manual approval needed
    if (!isQualitasUser) {
      await admin.firestore().collection('userRequests').doc(auth.uid).set({
        uid: auth.uid,
        email: user.email,
        displayName: user.displayName || '',
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    return { 
      success: true, 
      message: message,
      autoApproved: isQualitasUser,
      role: userRole
    };
    
  } catch (error) {
    logger.error('Error setting up new user:', error);
    throw new Error('Failed to setup user');
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
          // When setting admin role, also ensure status is approved
          // (can't be admin without being approved)
          status: role === 'admin' ? 'approved' : (targetRecordForRole.customClaims?.status || 'approved'),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: auth.uid
        };
        break;
        
      default:
        throw new Error('Invalid action');
    }
    
    // Update custom claims
    await admin.auth().setCustomUserClaims(targetUid, newClaims);
    
    // Update user request status if document exists (use set with merge to avoid NOT_FOUND error)
    if (action === 'approve' || action === 'reject') {
      try {
        const docRef = admin.firestore().collection('userRequests').doc(targetUid);
        const doc = await docRef.get();
        if (doc.exists) {
          await docRef.update({
            status: action === 'approve' ? 'approved' : 'rejected',
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            processedBy: auth.uid
          });
        }
        // If document doesn't exist, that's fine - custom claims are already set
      } catch (firestoreError) {
        // Log but don't fail - the important part (custom claims) is already done
        logger.warn('Could not update userRequests document:', firestoreError.message);
      }
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

// Delete a user (admin only)
exports.deleteUser = onCall({ cors: true }, async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new Error('Authentication required');
  }

  // Verify admin status
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};

  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new Error('Admin privileges required');
  }

  const { targetUid } = data;

  if (!targetUid) {
    throw new Error('targetUid is required');
  }

  // Prevent self-deletion
  if (targetUid === auth.uid) {
    throw new Error('Cannot delete your own account');
  }

  try {
    // Delete user from Firebase Auth
    await admin.auth().deleteUser(targetUid);

    // Delete user request document if exists
    try {
      await admin.firestore().collection('userRequests').doc(targetUid).delete();
    } catch (e) {
      // Ignore if document doesn't exist
    }

    logger.info('User deleted successfully', {
      targetUid,
      deletedBy: auth.uid
    });

    return { success: true, message: 'User deleted successfully' };

  } catch (error) {
    logger.error('Error deleting user:', error);
    throw new Error(`Failed to delete user: ${error.message}`);
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

// ==================== PURCHASE REQUEST FUNCTIONS ====================

// Helper function to group BOM items by vendor
const groupItemsByVendor = (categories, vendors) => {
  const vendorMap = new Map();

  // Create vendor lookup map
  vendors.forEach(vendor => {
    vendorMap.set(vendor.id, vendor);
  });

  // Group items by vendor
  const grouped = {};

  categories.forEach(category => {
    category.items.forEach(item => {
      // Get vendor information from finalizedVendor if available
      const vendorId = item.finalizedVendor?.id || 'unassigned';
      const vendorName = item.finalizedVendor?.name || 'Unassigned Vendor';

      if (!grouped[vendorId]) {
        const vendorInfo = vendorMap.get(vendorId) || {};
        grouped[vendorId] = {
          vendorId,
          vendorName,
          vendorEmail: vendorInfo.email || '',
          vendorPhone: vendorInfo.phone || '',
          vendorContact: vendorInfo.contactPerson || '',
          paymentTerms: vendorInfo.paymentTerms || '',
          leadTime: vendorInfo.leadTime || '',
          items: []
        };
      }

      grouped[vendorId].items.push({
        name: item.name,
        make: item.make || '',
        sku: item.sku || '',
        description: item.description || '',
        quantity: item.quantity,
        category: category.name,
        unitPrice: item.finalizedVendor?.price || null,
        linkedQuote: item.linkedQuote || null
      });
    });
  });

  return Object.values(grouped);
};

// Helper function to generate HTML email
const generatePREmailHTML = (data) => {
  const { projectDetails, groupedItems, companyName, requestedBy } = data;
  const date = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  let totalItems = 0;
  let totalEstimatedCost = 0;

  groupedItems.forEach(vendor => {
    totalItems += vendor.items.length;
    vendor.items.forEach(item => {
      if (item.unitPrice) {
        totalEstimatedCost += item.unitPrice * item.quantity;
      }
    });
  });

  const vendorSectionsHTML = groupedItems.map((vendor, index) => {
    const itemsHTML = vendor.items.map((item, itemIndex) => `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 12px 8px;">${itemIndex + 1}</td>
        <td style="padding: 12px 8px;"><strong>${item.name}</strong></td>
        <td style="padding: 12px 8px;">${item.make}</td>
        <td style="padding: 12px 8px;">${item.sku}</td>
        <td style="padding: 12px 8px;">${item.description}</td>
        <td style="padding: 12px 8px; text-align: center;">${item.quantity}</td>
        <td style="padding: 12px 8px;">${item.category}</td>
        ${item.unitPrice ? `<td style="padding: 12px 8px; text-align: right;">₹${item.unitPrice.toLocaleString('en-IN')}</td>` : '<td style="padding: 12px 8px; text-align: right;">-</td>'}
        <td style="padding: 12px 8px;">${item.linkedQuote ? `📄 <a href="${item.linkedQuote.url}" style="color: #0066cc; text-decoration: none;">${item.linkedQuote.name}</a>` : '-'}</td>
      </tr>
    `).join('');

    const subtotal = vendor.items.reduce((sum, item) => {
      return sum + (item.unitPrice ? item.unitPrice * item.quantity : 0);
    }, 0);

    return `
      <div style="border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 20px 0; background: #ffffff;">
        <h2 style="color: #0066cc; margin: 0 0 15px 0; font-size: 20px;">
          ${index + 1}. ${vendor.vendorName}
        </h2>
        <div style="background: #f8f9fa; padding: 12px; border-radius: 4px; margin-bottom: 15px;">
          ${vendor.vendorContact ? `<p style="margin: 4px 0;"><strong>Contact:</strong> ${vendor.vendorContact}</p>` : ''}
          ${vendor.vendorEmail ? `<p style="margin: 4px 0;"><strong>Email:</strong> ${vendor.vendorEmail}</p>` : ''}
          ${vendor.vendorPhone ? `<p style="margin: 4px 0;"><strong>Phone:</strong> ${vendor.vendorPhone}</p>` : ''}
          ${vendor.paymentTerms ? `<p style="margin: 4px 0;"><strong>Payment Terms:</strong> ${vendor.paymentTerms}</p>` : ''}
          ${vendor.leadTime ? `<p style="margin: 4px 0;"><strong>Lead Time:</strong> ${vendor.leadTime}</p>` : ''}
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">
              <th style="padding: 12px 8px; text-align: left;">#</th>
              <th style="padding: 12px 8px; text-align: left;">Item Name</th>
              <th style="padding: 12px 8px; text-align: left;">Make/Brand</th>
              <th style="padding: 12px 8px; text-align: left;">SKU/Part No.</th>
              <th style="padding: 12px 8px; text-align: left;">Description</th>
              <th style="padding: 12px 8px; text-align: center;">Quantity</th>
              <th style="padding: 12px 8px; text-align: left;">Category</th>
              <th style="padding: 12px 8px; text-align: right;">Unit Price</th>
              <th style="padding: 12px 8px; text-align: left;">Quote</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHTML}
          </tbody>
        </table>

        <div style="text-align: right; margin-top: 15px; padding: 12px; background: #f8f9fa; border-radius: 4px;">
          <p style="margin: 4px 0;"><strong>Items for this vendor:</strong> ${vendor.items.length}</p>
          ${subtotal > 0 ? `<p style="margin: 4px 0; font-size: 16px; color: #0066cc;"><strong>Subtotal:</strong> ₹${subtotal.toLocaleString('en-IN')}</p>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Purchase Request - ${projectDetails.projectName}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4;">
  <div style="max-width: 900px; margin: 20px auto; background: #ffffff; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0066cc 0%, #0052a3 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0;">
      <h1 style="margin: 0 0 10px 0; font-size: 28px;">Purchase Request</h1>
      <p style="margin: 0; font-size: 16px; opacity: 0.9;">
        <strong>${companyName}</strong>
      </p>
    </div>

    <!-- Project Info -->
    <div style="padding: 25px; background: #f8f9fa; border-bottom: 2px solid #e9ecef;">
      <table style="width: 100%; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0;"><strong>Project:</strong></td>
          <td style="padding: 8px 0;">${projectDetails.projectName} (${projectDetails.projectId})</td>
          <td style="padding: 8px 0;"><strong>Client:</strong></td>
          <td style="padding: 8px 0;">${projectDetails.clientName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Request Date:</strong></td>
          <td style="padding: 8px 0;">${date}</td>
          <td style="padding: 8px 0;"><strong>Requested By:</strong></td>
          <td style="padding: 8px 0;">${requestedBy}</td>
        </tr>
      </table>
    </div>

    <!-- Vendor Sections -->
    <div style="padding: 25px;">
      <h2 style="color: #333; margin-top: 0;">Items Grouped by Vendor</h2>
      ${vendorSectionsHTML}
    </div>

    <!-- Summary -->
    <div style="padding: 25px; background: #f8f9fa; border-top: 2px solid #e9ecef;">
      <h3 style="color: #0066cc; margin-top: 0;">Summary</h3>
      <table style="width: 100%; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0;"><strong>Total Items:</strong></td>
          <td style="padding: 8px 0;">${totalItems}</td>
          <td style="padding: 8px 0;"><strong>Total Vendors:</strong></td>
          <td style="padding: 8px 0;">${groupedItems.length}</td>
        </tr>
        ${totalEstimatedCost > 0 ? `
        <tr>
          <td style="padding: 8px 0;"><strong>Total Estimated Cost:</strong></td>
          <td colspan="3" style="padding: 8px 0; font-size: 16px; color: #0066cc;"><strong>₹${totalEstimatedCost.toLocaleString('en-IN')}</strong></td>
        </tr>
        ` : ''}
      </table>
    </div>

    <!-- Footer -->
    <div style="padding: 20px; background: #343a40; color: #fff; text-align: center; font-size: 12px; border-radius: 0 0 8px 8px;">
      <p style="margin: 0 0 5px 0;">This is an automated purchase request generated by BOM Tracker System</p>
      <p style="margin: 0; opacity: 0.8;">Please review and create official purchase orders as needed</p>
    </div>
  </div>
</body>
</html>
  `;
};

// Helper function to strip HTML for plain text version
const stripHtml = (html) => {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
};

// Send Purchase Request via SendGrid
exports.sendPurchaseRequest = onCall(
  { secrets: [sendgridApiKey] },
  async (request) => {
    const { auth, data } = request;

    if (!auth) {
      throw new Error('Authentication required');
    }

    try {
      const {
        projectDetails,
        categories,
        vendors,
        recipients,
        companyName,
        fromEmail
      } = data;

      // Validate required data
      if (!projectDetails || !categories || !recipients || recipients.length === 0) {
        throw new Error('Missing required data for purchase request');
      }

      // Get user info
      const userRecord = await admin.auth().getUser(auth.uid);
      const requestedBy = userRecord.email || 'Unknown User';

      // Group items by vendor
      const groupedItems = groupItemsByVendor(categories, vendors || []);

      // Generate HTML email
      const htmlContent = generatePREmailHTML({
        projectDetails,
        groupedItems,
        companyName: companyName || 'Qualitas Technologies Pvt Ltd',
        requestedBy
      });

      // Configure SendGrid
      sgMail.setApiKey(sendgridApiKey.value());

      // Prepare email message
      const msg = {
        to: recipients,
        from: fromEmail || 'info@qualitastech.com', // Must be verified in SendGrid
        subject: `Purchase Request - ${projectDetails.projectName} - ${new Date().toLocaleDateString('en-IN')}`,
        html: htmlContent,
        text: stripHtml(htmlContent),
        trackingSettings: {
          clickTracking: {
            enable: false,
            enableText: false
          }
        }
      };

      // Send email
      const response = await sgMail.send(msg);

      logger.info('Purchase request sent successfully', {
        projectId: projectDetails.projectId,
        projectName: projectDetails.projectName,
        recipients: recipients,
        itemCount: groupedItems.reduce((sum, vendor) => sum + vendor.items.length, 0),
        vendorCount: groupedItems.length,
        sentBy: auth.uid,
        statusCode: response[0].statusCode
      });

      return {
        success: true,
        message: 'Purchase request sent successfully',
        statusCode: response[0].statusCode,
        recipients: recipients
      };

    } catch (error) {
      logger.error('Error sending purchase request:', error);
      throw new Error(`Failed to send purchase request: ${error.message}`);
    }
  }
);

// Extract text from PDF quotation
// This function downloads a PDF from a URL and extracts its text content
// Note: pdfParse is already imported at the top of the file

exports.extractQuotationText = onCall(
  async (request) => {
    const { auth, data } = request;

    if (!auth) {
      throw new Error('Authentication required');
    }

    try {
      const { quotationId, fileUrl } = data;

      if (!quotationId || !fileUrl) {
        throw new Error('Missing required parameters: quotationId and fileUrl');
      }

      logger.info('Starting PDF text extraction', {
        quotationId,
        fileUrl,
        userId: auth.uid
      });

      // Download the PDF file from Firebase Storage
      const bucket = admin.storage().bucket();

      // Extract the storage path from the URL
      // URL format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?...
      const urlParts = fileUrl.split('/o/')[1];
      if (!urlParts) {
        throw new Error('Invalid file URL format');
      }
      const filePath = decodeURIComponent(urlParts.split('?')[0]);

      logger.info('Downloading PDF', { filePath });

      // Download file to buffer
      const file = bucket.file(filePath);
      const [fileBuffer] = await file.download();

      logger.info('PDF downloaded, extracting text', {
        bufferSize: fileBuffer.length
      });

      // Extract text from PDF
      const pdfData = await pdfParse(fileBuffer);
      const extractedText = pdfData.text;

      logger.info('Text extraction complete', {
        quotationId,
        textLength: extractedText.length,
        numPages: pdfData.numpages
      });

      // Update Firestore document with extracted text
      await admin.firestore().collection('quotations').doc(quotationId).update({
        extractedText: extractedText,
        textExtractedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'text_extracted'
      });

      logger.info('Firestore updated successfully', { quotationId });

      return {
        success: true,
        textLength: extractedText.length,
        numPages: pdfData.numpages,
        quotationId: quotationId
      };

    } catch (error) {
      logger.error('Error extracting PDF text:', error);

      // Update status to error if quotationId is available
      if (data.quotationId) {
        try {
          await admin.firestore().collection('quotations').doc(data.quotationId).update({
            status: 'error',
            errorMessage: error.message
          });
        } catch (updateError) {
          logger.error('Failed to update error status:', updateError);
        }
      }

      throw new Error(`Failed to extract PDF text: ${error.message}`);
    }
  }
);

// ==================== PDF QUOTE PARSING FUNCTIONS ====================

/**
 * Parse vendor quote PDF and extract structured line items
 * Uses unpdf for text extraction, falls back to OpenAI Vision for scanned PDFs
 *
 * @param {string} documentId - The document ID in Firestore
 * @param {string} fileUrl - Firebase Storage URL of the PDF
 * @param {string} projectId - The project ID
 * @returns {Object} Parsed quote data with line items
 */
exports.parseVendorQuotePDF = onRequest(
  {
    secrets: [openaiApiKeySecret],
    timeoutSeconds: 180, // 3 minutes for large PDFs
    memory: '1GiB'
  },
  async (request, response) => {
    // Enable CORS
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    const startTime = Date.now();

    try {
      const { documentId, fileUrl, projectId, bomItems } = request.body;

      // Validate required fields
      if (!documentId || !fileUrl) {
        response.status(400).json({
          error: 'Missing required fields: documentId and fileUrl'
        });
        return;
      }

      const openaiApiKey = openaiApiKeySecret.value();
      if (!openaiApiKey) {
        response.status(500).json({ error: 'AI service not configured' });
        return;
      }

      logger.info('Starting PDF quote parsing', {
        documentId,
        fileUrl: fileUrl.substring(0, 100) + '...',
        projectId
      });

      // Download PDF from Firebase Storage
      const bucket = admin.storage().bucket();
      const urlParts = fileUrl.split('/o/')[1];
      if (!urlParts) {
        response.status(400).json({ error: 'Invalid file URL format' });
        return;
      }
      const filePath = decodeURIComponent(urlParts.split('?')[0]);

      logger.info('Downloading PDF', { filePath });

      const file = bucket.file(filePath);
      const [fileBuffer] = await file.download();
      const fileSize = fileBuffer.length;

      logger.info('PDF downloaded', { fileSize });

      // Step 1: Try to extract text using pdf-parse
      let extractedText = '';
      let useVisionAPI = false;
      let numPages = 1;

      try {
        const pdfData = await pdfParse(fileBuffer);
        extractedText = pdfData.text || '';
        numPages = pdfData.numpages || 1;

        logger.info('PDF loaded', { numPages, textLength: extractedText.length });

        // Check if we got meaningful text (scanned PDFs return very little)
        const wordCount = extractedText.split(/\s+/).filter(w => w.length > 1).length;
        logger.info('Text extraction complete', {
          textLength: extractedText.length,
          wordCount,
          numPages
        });

        // If less than 50 words per page on average, likely a scanned PDF
        if (wordCount < (numPages * 50)) {
          logger.info('Minimal text extracted, switching to Vision API');
          useVisionAPI = true;
        }

      } catch (extractError) {
        logger.warn('Text extraction failed, using Vision API', { error: extractError.message });
        useVisionAPI = true;
      }

      // Step 2: Parse with OpenAI
      let parsedQuote;

      const systemPrompt = `You are an expert at parsing vendor quotations and invoices. Extract all line items from the document.

For each line item, extract:
- partName: The product/part name or description
- partNumber: Part number, SKU, or model number (if present)
- make: Manufacturer or brand (if present)
- quantity: Number of units
- unitPrice: Price per unit in INR (remove ₹ symbol, handle lakhs notation like 1,50,000)
- totalPrice: Total price for this line (quantity × unitPrice)
- hsnCode: HSN/SAC code if present

Also extract document-level information:
- vendorName: Name of the vendor/supplier
- vendorGST: GST number if present
- quoteNumber: Quote/Invoice number
- quoteDate: Date of the quote
- validUntil: Quote validity date if present
- subtotal: Subtotal before tax
- gstAmount: GST amount
- grandTotal: Grand total including tax
- paymentTerms: Payment terms if mentioned
- deliveryTerms: Delivery terms or lead time if mentioned

IMPORTANT:
- Handle Indian number formatting (e.g., 1,50,000 = 150000)
- Extract ALL line items, even if there are many
- If a field is not present, use null
- Return ONLY valid JSON

JSON OUTPUT FORMAT:
{
  "documentInfo": {
    "vendorName": "string",
    "vendorGST": "string or null",
    "quoteNumber": "string or null",
    "quoteDate": "string or null",
    "validUntil": "string or null",
    "subtotal": number or null,
    "gstAmount": number or null,
    "gstPercent": number or null,
    "grandTotal": number or null,
    "paymentTerms": "string or null",
    "deliveryTerms": "string or null"
  },
  "lineItems": [
    {
      "lineNumber": 1,
      "partName": "string",
      "partNumber": "string or null",
      "make": "string or null",
      "description": "string or null",
      "quantity": number,
      "unit": "string (pcs, nos, etc.)",
      "unitPrice": number,
      "totalPrice": number,
      "hsnCode": "string or null"
    }
  ],
  "totalLineItems": number,
  "parseConfidence": "high|medium|low",
  "notes": "any special observations about the document"
}`;

      if (useVisionAPI) {
        // Use OpenAI Vision API with PDF directly
        logger.info('Using OpenAI Vision API for scanned PDF');

        // Convert PDF buffer to base64
        const base64PDF = fileBuffer.toString('base64');

        const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Parse this vendor quotation/invoice PDF and extract all line items and document information.'
                  },
                  {
                    type: 'file',
                    file: {
                      filename: 'quote.pdf',
                      file_data: `data:application/pdf;base64,${base64PDF}`
                    }
                  }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 4000,
            response_format: { type: 'json_object' }
          })
        });

        if (!visionResponse.ok) {
          const errorData = await visionResponse.json().catch(() => ({}));
          logger.error('OpenAI Vision API error', errorData);
          throw new Error(`Vision API error: ${errorData.error?.message || 'Unknown error'}`);
        }

        const visionData = await visionResponse.json();
        parsedQuote = JSON.parse(visionData.choices[0]?.message?.content || '{}');

      } else {
        // Use text-based parsing (cheaper and faster)
        logger.info('Using text-based parsing');

        // Include BOM items context if provided for better matching
        let userPrompt = `Parse this vendor quotation and extract all line items:\n\n${extractedText}`;

        if (bomItems && bomItems.length > 0) {
          const bomContext = bomItems.map(item =>
            `- ${item.name}${item.sku ? ` (SKU: ${item.sku})` : ''}${item.make ? ` [${item.make}]` : ''}`
          ).join('\n');
          userPrompt += `\n\n--- BOM Items to match against ---\n${bomContext}`;
        }

        const textResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
            max_tokens: 4000,
            response_format: { type: 'json_object' }
          })
        });

        if (!textResponse.ok) {
          const errorData = await textResponse.json().catch(() => ({}));
          logger.error('OpenAI text API error', errorData);
          throw new Error(`Text API error: ${errorData.error?.message || 'Unknown error'}`);
        }

        const textData = await textResponse.json();
        parsedQuote = JSON.parse(textData.choices[0]?.message?.content || '{}');
      }

      // Validate and clean parsed data
      if (!parsedQuote.lineItems) {
        parsedQuote.lineItems = [];
      }

      // Ensure all prices are numbers
      parsedQuote.lineItems = parsedQuote.lineItems.map((item, index) => ({
        ...item,
        lineNumber: item.lineNumber || index + 1,
        quantity: parseFloat(item.quantity) || 1,
        unitPrice: parseFloat(item.unitPrice) || 0,
        totalPrice: parseFloat(item.totalPrice) || (parseFloat(item.quantity) * parseFloat(item.unitPrice)) || 0
      }));

      // Calculate totals if not present
      if (!parsedQuote.documentInfo) {
        parsedQuote.documentInfo = {};
      }

      const calculatedSubtotal = parsedQuote.lineItems.reduce((sum, item) => sum + item.totalPrice, 0);
      if (!parsedQuote.documentInfo.subtotal) {
        parsedQuote.documentInfo.subtotal = calculatedSubtotal;
      }

      const processingTime = Date.now() - startTime;

      logger.info('PDF parsing complete', {
        documentId,
        lineItemsFound: parsedQuote.lineItems.length,
        useVisionAPI,
        processingTimeMs: processingTime
      });

      // Optionally update Firestore with parsed data
      if (projectId && documentId) {
        try {
          const db = admin.firestore();
          await db
            .collection('projects')
            .doc(projectId)
            .collection('documents')
            .doc(documentId)
            .update({
              parsedQuoteData: parsedQuote,
              parsedAt: admin.firestore.FieldValue.serverTimestamp(),
              parseMethod: useVisionAPI ? 'vision' : 'text'
            });
          logger.info('Firestore updated with parsed quote data', { documentId });
        } catch (firestoreError) {
          logger.warn('Could not update Firestore', { error: firestoreError.message });
        }
      }

      response.status(200).json({
        success: true,
        documentId,
        parsedQuote,
        metadata: {
          parseMethod: useVisionAPI ? 'vision' : 'text',
          fileSize,
          processingTimeMs: processingTime,
          lineItemsFound: parsedQuote.lineItems.length
        }
      });

    } catch (error) {
      logger.error('Error parsing PDF quote', { error: error.message, stack: error.stack });
      response.status(500).json({
        error: 'Failed to parse PDF quote',
        details: error.message
      });
    }
  }
);

/**
 * Parse an image file (JPG, PNG) using OpenAI Vision API
 * For vendor quotes that are photos/scans saved as images
 */
exports.parseVendorQuoteImage = onRequest(
  {
    secrets: [openaiApiKeySecret],
    timeoutSeconds: 120
  },
  async (request, response) => {
    // Enable CORS
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    const startTime = Date.now();

    try {
      const { documentId, fileUrl, projectId } = request.body;

      if (!documentId || !fileUrl) {
        response.status(400).json({
          error: 'Missing required fields: documentId and fileUrl'
        });
        return;
      }

      const openaiApiKey = openaiApiKeySecret.value();
      if (!openaiApiKey) {
        response.status(500).json({ error: 'AI service not configured' });
        return;
      }

      logger.info('Starting image quote parsing', { documentId });

      // Download image from Firebase Storage
      const bucket = admin.storage().bucket();
      const urlParts = fileUrl.split('/o/')[1];
      if (!urlParts) {
        response.status(400).json({ error: 'Invalid file URL format' });
        return;
      }
      const filePath = decodeURIComponent(urlParts.split('?')[0]);

      const file = bucket.file(filePath);
      const [fileBuffer] = await file.download();
      const [metadata] = await file.getMetadata();
      const contentType = metadata.contentType || 'image/jpeg';

      // Convert to base64
      const base64Image = fileBuffer.toString('base64');
      const dataUrl = `data:${contentType};base64,${base64Image}`;

      const systemPrompt = `You are an expert at parsing vendor quotations and invoices from images. Extract all line items from the document.

For each line item, extract:
- partName: The product/part name or description
- partNumber: Part number, SKU, or model number (if present)
- make: Manufacturer or brand (if present)
- quantity: Number of units
- unitPrice: Price per unit in INR
- totalPrice: Total price for this line

Also extract document-level info: vendorName, quoteNumber, quoteDate, grandTotal, gstAmount.

Handle Indian number formatting (e.g., 1,50,000 = 150000).
Return ONLY valid JSON in the same format as PDF parsing.`;

      const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Parse this vendor quotation/invoice image and extract all line items.'
                },
                {
                  type: 'image_url',
                  image_url: { url: dataUrl }
                }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 4000,
          response_format: { type: 'json_object' }
        })
      });

      if (!visionResponse.ok) {
        const errorData = await visionResponse.json().catch(() => ({}));
        throw new Error(`Vision API error: ${errorData.error?.message || 'Unknown error'}`);
      }

      const visionData = await visionResponse.json();
      const parsedQuote = JSON.parse(visionData.choices[0]?.message?.content || '{}');

      // Clean and validate
      if (!parsedQuote.lineItems) parsedQuote.lineItems = [];
      parsedQuote.lineItems = parsedQuote.lineItems.map((item, index) => ({
        ...item,
        lineNumber: index + 1,
        quantity: parseFloat(item.quantity) || 1,
        unitPrice: parseFloat(item.unitPrice) || 0,
        totalPrice: parseFloat(item.totalPrice) || 0
      }));

      const processingTime = Date.now() - startTime;

      // Update Firestore
      if (projectId && documentId) {
        try {
          await admin.firestore()
            .collection('projects')
            .doc(projectId)
            .collection('documents')
            .doc(documentId)
            .update({
              parsedQuoteData: parsedQuote,
              parsedAt: admin.firestore.FieldValue.serverTimestamp(),
              parseMethod: 'vision-image'
            });
        } catch (e) {
          logger.warn('Could not update Firestore', { error: e.message });
        }
      }

      response.status(200).json({
        success: true,
        documentId,
        parsedQuote,
        metadata: {
          parseMethod: 'vision-image',
          processingTimeMs: processingTime,
          lineItemsFound: parsedQuote.lineItems.length
        }
      });

    } catch (error) {
      logger.error('Error parsing image quote', { error: error.message });
      response.status(500).json({
        error: 'Failed to parse image quote',
        details: error.message
      });
    }
  }
);

// ==================== AI COMPLIANCE CHECKER FUNCTIONS ====================

/**
 * Run AI Compliance Check on BOM items
 * Validates item data quality and matches vendor quotes to BOM items
 */
exports.runComplianceCheck = onRequest(
  {
    secrets: [openaiApiKeySecret],
    timeoutSeconds: 300, // 5 minutes for PDF parsing
    memory: '1GiB'
  },
  async (request, response) => {
    // Enable CORS
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    const startTime = Date.now();

    try {
      const { projectId, bomItems, vendorQuotes, settings, parseDocuments = true } = request.body;

      // Validate input
      if (!projectId || !bomItems || !Array.isArray(bomItems)) {
        response.status(400).json({ error: 'projectId and bomItems array are required' });
        return;
      }

      const openaiApiKey = openaiApiKeySecret.value();
      if (!openaiApiKey) {
        response.status(500).json({ error: 'AI service not configured' });
        return;
      }

      const issues = [];
      const issuesByType = {};
      const issuesBySeverity = { error: 0, warning: 0, info: 0 };

      // Helper to add issue
      const addIssue = (issue) => {
        issues.push({
          ...issue,
          id: `issue-${issues.length + 1}`,
          createdAt: new Date().toISOString()
        });
        issuesByType[issue.issueType] = (issuesByType[issue.issueType] || 0) + 1;
        issuesBySeverity[issue.severity]++;
      };

      // Build lookup maps for validation
      const itemsByName = new Map();
      const itemsBySku = new Map();
      const linkedDocumentIds = new Set();

      // Collect all linked document IDs from vendor quotes
      vendorQuotes?.forEach(quote => {
        if (quote.documentId) {
          linkedDocumentIds.add(quote.documentId);
        }
      });

      // First pass: build lookup maps for duplicate detection
      bomItems.forEach(item => {
        const itemType = item.itemType || 'component';

        // Track items by normalized name for duplicate detection
        const normalizedName = (item.name || '').toLowerCase().trim();
        if (normalizedName) {
          if (!itemsByName.has(normalizedName)) {
            itemsByName.set(normalizedName, []);
          }
          itemsByName.get(normalizedName).push(item);
        }

        // Track items by SKU for duplicate detection
        if (itemType === 'component' && item.sku) {
          const normalizedSku = item.sku.toLowerCase().trim();
          if (!itemsBySku.has(normalizedSku)) {
            itemsBySku.set(normalizedSku, []);
          }
          itemsBySku.get(normalizedSku).push(item);
        }
      });

      // Phase 1: Comprehensive validation checks
      bomItems.forEach(item => {
        const itemType = item.itemType || 'component';
        const isComponent = itemType === 'component';

        // ============ CRITICAL ERRORS ============

        // 1. Check for missing required fields - Name
        if (!item.name || item.name.trim() === '') {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Item',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'error',
            message: 'Item name is required',
            details: 'Every BOM item must have a name.',
            currentValue: item.name || '',
            suggestedFix: null
          });
        }

        // 2. Check for missing Make/Manufacturer (REQUIRED for components)
        if (isComponent && (!item.make || item.make.trim() === '')) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Item',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'error',
            message: 'Manufacturer/Make is required',
            details: 'Every component must have a manufacturer specified for procurement.',
            currentValue: '',
            suggestedFix: null
          });
        }

        // 3. Check for missing SKU (REQUIRED for components)
        if (isComponent && (!item.sku || item.sku.trim() === '')) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Item',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'error',
            message: 'SKU/Part Number is required',
            details: 'Every component must have a SKU or part number for accurate ordering.',
            currentValue: '',
            suggestedFix: null
          });
        }

        // 4. Check for missing linked vendor quote (REQUIRED for components)
        if (isComponent) {
          // Check if this item has a linked quote document
          // Either via item.linkedQuoteDocumentId OR via document.linkedBOMItems
          const hasLinkedQuoteOnItem = !!item.linkedQuoteDocumentId;
          const hasLinkedQuoteOnDocument = vendorQuotes?.some(quote =>
            quote.linkedBOMItems?.includes(item.id)
          );
          const hasLinkedQuote = hasLinkedQuoteOnItem || hasLinkedQuoteOnDocument;

          if (!hasLinkedQuote) {
            addIssue({
              bomItemId: item.id,
              bomItemName: item.name || 'Unnamed Item',
              category: item.category || 'Unknown',
              issueType: 'missing-quote',
              severity: 'error',
              message: 'No vendor quote linked',
              details: 'Every component must have a linked vendor quote before ordering.',
              currentValue: '',
              suggestedFix: null
            });
          }
        }

        // ============ WARNINGS ============

        // 5. Check for missing description
        if (!item.description || item.description.trim() === '') {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Item',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'warning',
            message: 'Item description is missing',
            details: 'Adding a description helps with clarity and quote matching.',
            currentValue: '',
            suggestedFix: {
              type: 'update-field',
              field: 'description',
              suggestedValue: item.name,
              description: 'Use item name as description'
            }
          });
        }

        // 6. Check SKU format for components
        if (isComponent && item.sku) {
          const skuIssues = [];
          if (item.sku.length < 3) {
            skuIssues.push('SKU is too short (minimum 3 characters)');
          }
          if (/\s{2,}/.test(item.sku)) {
            skuIssues.push('SKU contains multiple consecutive spaces');
          }
          if (/[<>{}[\]\\|]/.test(item.sku)) {
            skuIssues.push('SKU contains invalid characters');
          }
          if (/^\s|\s$/.test(item.sku)) {
            skuIssues.push('SKU has leading or trailing spaces');
          }

          if (skuIssues.length > 0) {
            addIssue({
              bomItemId: item.id,
              bomItemName: item.name,
              category: item.category || 'Unknown',
              issueType: 'invalid-sku',
              severity: 'warning',
              message: 'SKU format issues detected',
              details: skuIssues.join('. '),
              currentValue: item.sku,
              suggestedFix: {
                type: 'update-field',
                field: 'sku',
                suggestedValue: item.sku.trim().replace(/\s+/g, '-'),
                description: 'Clean up SKU format'
              }
            });
          }
        }

        // 7. Check for missing price on ordered/received items
        if ((item.status === 'ordered' || item.status === 'received') && !item.price) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name,
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'warning',
            message: 'Price is missing for ordered item',
            details: 'Items that are ordered should have a price for accurate cost tracking.',
            currentValue: '',
            suggestedFix: null
          });
        }

        // 8. Check for zero or negative quantity
        if (!item.quantity || item.quantity <= 0) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Item',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'warning',
            message: 'Invalid quantity',
            details: 'Quantity must be greater than zero.',
            currentValue: String(item.quantity || 0),
            suggestedFix: {
              type: 'update-field',
              field: 'quantity',
              suggestedValue: 1,
              description: 'Set quantity to 1'
            }
          });
        }

        // 9. Check for unreasonably high quantity (potential data entry error)
        if (item.quantity > 10000) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name,
            category: item.category || 'Unknown',
            issueType: 'quantity-mismatch',
            severity: 'warning',
            message: 'Unusually high quantity',
            details: `Quantity of ${item.quantity} seems unusually high. Please verify this is correct.`,
            currentValue: String(item.quantity),
            suggestedFix: null
          });
        }

        // 10. Check for missing category
        if (!item.category || item.category.trim() === '' || item.category === 'Uncategorized') {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Item',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'warning',
            message: 'Item is uncategorized',
            details: 'Assign a category for better organization and reporting.',
            currentValue: item.category || '',
            suggestedFix: null
          });
        }

        // 11. Check for missing finalized vendor on items ready to order
        if (isComponent && item.price && !item.finalizedVendor) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name,
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'warning',
            message: 'No vendor selected',
            details: 'Item has a price but no vendor has been selected for ordering.',
            currentValue: '',
            suggestedFix: null
          });
        }

        // ============ INFO / SUGGESTIONS ============

        // 12. Check for very short item names (might be abbreviations)
        if (item.name && item.name.trim().length < 5) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name,
            category: item.category || 'Unknown',
            issueType: 'name-format',
            severity: 'info',
            message: 'Item name is very short',
            details: 'Short names might be unclear. Consider using a more descriptive name.',
            currentValue: item.name,
            suggestedFix: null
          });
        }

        // 13. Check for items with price but no linked quote
        // (This is an INFO level duplicate check - the ERROR is already added above for all components)
        // Skip this to avoid duplicate issues - the main check at #4 covers all components without quotes

        // 14. Check for services without rate
        if (!isComponent && (!item.price || item.price <= 0)) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Service',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'warning',
            message: 'Service rate is missing',
            details: 'Services should have a rate per day specified.',
            currentValue: '',
            suggestedFix: null
          });
        }
      });

      // ============ CROSS-ITEM CHECKS ============

      // 15. Check for duplicate items by name
      itemsByName.forEach((items, name) => {
        if (items.length > 1) {
          items.forEach(item => {
            addIssue({
              bomItemId: item.id,
              bomItemName: item.name,
              category: item.category || 'Unknown',
              issueType: 'duplicate-item',
              severity: 'warning',
              message: 'Possible duplicate item',
              details: `${items.length} items have the same name "${item.name}". Verify these are not duplicates.`,
              currentValue: item.name,
              suggestedFix: null
            });
          });
        }
      });

      // 16. Check for duplicate SKUs
      itemsBySku.forEach((items, sku) => {
        if (items.length > 1) {
          items.forEach(item => {
            addIssue({
              bomItemId: item.id,
              bomItemName: item.name,
              category: item.category || 'Unknown',
              issueType: 'duplicate-item',
              severity: 'error',
              message: 'Duplicate SKU detected',
              details: `${items.length} items share SKU "${item.sku}". Each component should have a unique SKU.`,
              currentValue: item.sku,
              suggestedFix: null
            });
          });
        }
      });

      // Phase 2: Parse vendor quote PDFs and match to BOM items
      let quoteAnalysis = [];
      let quotesMatched = 0;
      let documentsParsed = 0;
      const parsedQuoteData = [];

      if (vendorQuotes && vendorQuotes.length > 0 && bomItems.length > 0) {
        const bucket = admin.storage().bucket();

        // Helper function to parse a single PDF
        const parsePDFDocument = async (quote) => {
          try {
            // Check if already parsed
            if (quote.parsedQuoteData && quote.parsedQuoteData.lineItems) {
              logger.info('Using cached parsed data', { documentId: quote.documentId });
              return quote.parsedQuoteData;
            }

            // Check if we have a file URL
            if (!quote.fileUrl) {
              logger.warn('No file URL for quote', { documentId: quote.documentId });
              return null;
            }

            // Download PDF from Firebase Storage
            const urlParts = quote.fileUrl.split('/o/')[1];
            if (!urlParts) {
              logger.warn('Invalid file URL format', { documentId: quote.documentId });
              return null;
            }
            const filePath = decodeURIComponent(urlParts.split('?')[0]);

            logger.info('Downloading PDF for parsing', { documentId: quote.documentId, filePath });

            const file = bucket.file(filePath);
            const [fileBuffer] = await file.download();

            // Try text extraction first using pdf-parse
            let extractedText = '';
            let useVisionAPI = false;
            let numPages = 1;

            try {
              const pdfData = await pdfParse(fileBuffer);
              extractedText = pdfData.text || '';
              numPages = pdfData.numpages || 1;

              const wordCount = extractedText.split(/\s+/).filter(w => w.length > 1).length;

              // If less than 50 words per page, likely scanned
              if (wordCount < (numPages * 50)) {
                useVisionAPI = true;
              }
            } catch (extractError) {
              logger.warn('Text extraction failed', { error: extractError.message });
              useVisionAPI = true;
            }

            // Parse with OpenAI
            const parsePrompt = `You are an expert at parsing vendor quotations. Extract all line items.

For each line item, extract: partName, partNumber (SKU), make, quantity, unitPrice, totalPrice.
Also extract: vendorName, quoteNumber, quoteDate, grandTotal, gstAmount.

Handle Indian number formatting (1,50,000 = 150000).
Return ONLY valid JSON:
{
  "documentInfo": { "vendorName": "", "quoteNumber": "", "quoteDate": "", "grandTotal": null, "gstAmount": null },
  "lineItems": [{ "partName": "", "partNumber": null, "make": null, "quantity": 1, "unitPrice": 0, "totalPrice": 0 }]
}`;

            let parsedResult;

            if (useVisionAPI) {
              // Use Vision API for scanned PDFs
              const base64PDF = fileBuffer.toString('base64');

              const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${openaiApiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gpt-4o',
                  messages: [
                    { role: 'system', content: parsePrompt },
                    {
                      role: 'user',
                      content: [
                        { type: 'text', text: 'Parse this vendor quotation PDF and extract all line items.' },
                        { type: 'file', file: { filename: 'quote.pdf', file_data: `data:application/pdf;base64,${base64PDF}` } }
                      ]
                    }
                  ],
                  temperature: 0.1,
                  max_tokens: 4000,
                  response_format: { type: 'json_object' }
                })
              });

              if (visionResponse.ok) {
                const data = await visionResponse.json();
                parsedResult = JSON.parse(data.choices[0]?.message?.content || '{}');
              }
            } else {
              // Use text-based parsing
              const textResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${openaiApiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
                  messages: [
                    { role: 'system', content: parsePrompt },
                    { role: 'user', content: `Parse this vendor quotation:\n\n${extractedText}` }
                  ],
                  temperature: 0.1,
                  max_tokens: 4000,
                  response_format: { type: 'json_object' }
                })
              });

              if (textResponse.ok) {
                const data = await textResponse.json();
                parsedResult = JSON.parse(data.choices[0]?.message?.content || '{}');
              }
            }

            // Store parsed data back to Firestore for future use
            if (parsedResult && parsedResult.lineItems && projectId) {
              try {
                await admin.firestore()
                  .collection('projects')
                  .doc(projectId)
                  .collection('documents')
                  .doc(quote.documentId)
                  .update({
                    parsedQuoteData: parsedResult,
                    parsedAt: admin.firestore.FieldValue.serverTimestamp(),
                    parseMethod: useVisionAPI ? 'vision' : 'text'
                  });
              } catch (e) {
                logger.warn('Could not cache parsed data', { error: e.message });
              }
            }

            return parsedResult;

          } catch (parseError) {
            logger.error('Error parsing PDF', { documentId: quote.documentId, error: parseError.message });
            return null;
          }
        };

        // Parse all vendor quote PDFs if parseDocuments is enabled
        if (parseDocuments) {
          logger.info('Parsing vendor quote PDFs', { count: vendorQuotes.length });

          for (const quote of vendorQuotes) {
            const parsed = await parsePDFDocument(quote);
            if (parsed) {
              parsedQuoteData.push({
                documentId: quote.documentId,
                documentName: quote.documentName,
                ...parsed
              });
              documentsParsed++;
            }
          }

          logger.info('PDF parsing complete', { documentsParsed });
        }

        // Prepare data for AI analysis
        const bomItemsForAI = bomItems.map(item => ({
          id: item.id,
          name: item.name,
          make: item.make,
          sku: item.sku,
          description: item.description,
          quantity: item.quantity,
          price: item.price,
          category: item.category
        }));

        // Build quote data for AI - use parsed data or fall back to extractedText
        const quotesForAI = parsedQuoteData.length > 0
          ? parsedQuoteData.map(q => ({
              documentId: q.documentId,
              documentName: q.documentName,
              vendorName: q.documentInfo?.vendorName || 'Unknown',
              lineItems: q.lineItems || []
            }))
          : vendorQuotes.map(q => ({
              documentId: q.documentId,
              documentName: q.documentName,
              extractedText: q.extractedText || 'No text available'
            }));

        const systemPrompt = `You are a BOM compliance expert. Your task is to match vendor quote line items to BOM items and identify discrepancies.

Given BOM items and parsed vendor quote line items, you must:
1. Match quote line items to BOM items using:
   - SKU/Part number exact match (highest confidence)
   - Name similarity (medium confidence)
   - Make + partial name match (lower confidence)
2. Identify mismatches in quantity (flag any difference), price (flag if >15% different)
3. Flag BOM items that have no matching quote line

STRICT JSON OUTPUT:
{
  "quoteAnalysis": [
    {
      "documentId": "quote document ID",
      "documentName": "quote name",
      "vendorName": "vendor name",
      "lineMatches": [
        {
          "quoteLineItem": {
            "partName": "name from quote",
            "partNumber": "part number from quote or null",
            "make": "manufacturer or null",
            "quantity": number,
            "unitPrice": number
          },
          "bomItemId": "matched BOM item ID or null",
          "bomItemName": "matched BOM item name or null",
          "matchScore": 0-100,
          "matchReasons": ["reason1", "reason2"],
          "mismatches": ["mismatch description if any"]
        }
      ],
      "unmatchedQuoteLines": number,
      "unmatchedBOMItems": ["item IDs not matched"]
    }
  ],
  "suggestedFixes": [
    {
      "bomItemId": "item ID",
      "field": "name|description|sku|make|price",
      "currentValue": "current",
      "suggestedValue": "suggested based on quote",
      "reason": "why this change is suggested"
    }
  ]
}

CRITICAL: Return ONLY valid JSON. Be thorough in matching.`;

        const userPrompt = `BOM Items:
${JSON.stringify(bomItemsForAI, null, 2)}

Vendor Quotes (Parsed):
${JSON.stringify(quotesForAI, null, 2)}

Match the quote line items to BOM items. Flag any price or quantity mismatches.`;

        try {
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
              max_tokens: 4000,
              response_format: { type: 'json_object' }
            })
          });

          if (openaiResponse.ok) {
            const data = await openaiResponse.json();
            const aiResult = JSON.parse(data.choices[0]?.message?.content || '{}');

            quoteAnalysis = aiResult.quoteAnalysis || [];

            // Process AI results to create issues
            quoteAnalysis.forEach(qa => {
              // Count matched items
              qa.lineMatches?.forEach(match => {
                if (match.bomItemId && match.matchScore >= 50) {
                  quotesMatched++;

                  // Add mismatch issues
                  match.mismatches?.forEach(mismatch => {
                    const mismatchType = mismatch.toLowerCase().includes('price') ? 'price-mismatch' :
                                         mismatch.toLowerCase().includes('quantity') ? 'quantity-mismatch' :
                                         'quote-mismatch';
                    addIssue({
                      bomItemId: match.bomItemId,
                      bomItemName: match.bomItemName || 'Unknown',
                      category: 'Unknown',
                      issueType: mismatchType,
                      severity: mismatchType === 'price-mismatch' ? 'warning' : 'info',
                      message: `Quote mismatch: ${mismatch}`,
                      details: `From quote: ${qa.documentName}`,
                      documentId: qa.documentId,
                      documentName: qa.documentName,
                      confidence: match.matchScore
                    });
                  });
                }
              });

              // Add issues for unmatched BOM items
              qa.unmatchedBOMItems?.forEach(itemId => {
                const item = bomItems.find(i => i.id === itemId);
                if (item) {
                  addIssue({
                    bomItemId: itemId,
                    bomItemName: item.name,
                    category: item.category || 'Unknown',
                    issueType: 'missing-quote',
                    severity: 'info',
                    message: 'No matching line in vendor quote',
                    details: `Item not found in quote: ${qa.documentName}`,
                    documentId: qa.documentId,
                    documentName: qa.documentName
                  });
                }
              });
            });

            // Process suggested fixes from AI
            aiResult.suggestedFixes?.forEach(fix => {
              const item = bomItems.find(i => i.id === fix.bomItemId);
              if (item && fix.suggestedValue && fix.suggestedValue !== fix.currentValue) {
                addIssue({
                  bomItemId: fix.bomItemId,
                  bomItemName: item.name,
                  category: item.category || 'Unknown',
                  issueType: fix.field === 'name' ? 'name-format' :
                             fix.field === 'description' ? 'description-mismatch' :
                             'invalid-sku',
                  severity: 'info',
                  message: `Suggested update for ${fix.field}`,
                  details: fix.reason,
                  currentValue: fix.currentValue,
                  suggestedFix: {
                    type: 'update-field',
                    field: fix.field,
                    suggestedValue: fix.suggestedValue,
                    description: fix.reason
                  },
                  confidence: 75
                });
              }
            });
          }
        } catch (aiError) {
          logger.error('AI analysis error:', aiError);
          // Continue without AI analysis - basic checks are still useful
        }
      }

      // Build final report
      const report = {
        id: `compliance-${Date.now()}`,
        projectId,
        createdAt: new Date().toISOString(),
        createdBy: 'system',
        status: 'completed',
        totalItemsChecked: bomItems.length,
        itemsWithIssues: new Set(issues.map(i => i.bomItemId)).size,
        totalIssues: issues.length,
        issuesByType,
        issuesBySeverity,
        quotesAnalyzed: vendorQuotes?.length || 0,
        documentsParsed,
        quotesMatched,
        quoteMismatches: issues.filter(i => i.issueType === 'quote-mismatch' ||
                                           i.issueType === 'price-mismatch' ||
                                           i.issueType === 'quantity-mismatch').length,
        issues,
        processingTimeMs: Date.now() - startTime
      };

      logger.info('Compliance check completed', {
        projectId,
        itemsChecked: bomItems.length,
        documentsParsed,
        issuesFound: issues.length,
        processingTimeMs: report.processingTimeMs
      });

      response.status(200).json({
        success: true,
        report,
        quoteAnalysis,
        parsedQuoteData
      });

    } catch (error) {
      logger.error('Error in compliance check:', error);
      response.status(500).json({
        error: 'Internal server error during compliance check',
        details: error.message
      });
    }
  }
);

/**
 * Trigger spec sheet search via n8n workflow
 * This function sends a request to n8n which will search for spec sheets
 * and then updates Firestore with the result
 */
exports.triggerSpecSearch = onRequest(
  async (request, response) => {
    // Enable CORS
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    try {
      const { bomItemId, projectId, itemName, make, sku, userId } = request.body;

      // Validate required fields
      if (!bomItemId || !projectId || !itemName) {
        response.status(400).json({
          error: 'Missing required fields: bomItemId, projectId, itemName'
        });
        return;
      }

      // Production n8n webhook URL (workflow must be activated in n8n for this to work)
      const n8nWebhookUrl = 'https://n8n.qualitastech.com/webhook/spec-search';

      // Generate a unique search ID
      const searchId = `spec-search-${bomItemId}-${Date.now()}`;

      // Prepare the payload for n8n
      const n8nPayload = {
        searchId,
        bomItemId,
        projectId,
        itemName,
        make: make || '',
        sku: sku || '',
        userId: userId || 'system',
        timestamp: new Date().toISOString()
      };

      logger.info('Triggering n8n spec search', {
        searchId,
        bomItemId,
        itemName,
        make
      });

      // Call n8n webhook
      const n8nResponse = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(n8nPayload)
      });

      if (!n8nResponse.ok) {
        const errorText = await n8nResponse.text();
        logger.error('n8n webhook error:', { status: n8nResponse.status, error: errorText });
        response.status(500).json({
          success: false,
          error: 'Failed to trigger spec search workflow'
        });
        return;
      }

      // Parse the n8n response which contains the spec URL
      const n8nResult = await n8nResponse.json();
      logger.info('n8n response:', n8nResult);

      // If n8n returned a specificationUrl, update the BOM item in Firestore
      if (n8nResult.success && n8nResult.specificationUrl) {
        try {
          // Get the BOM data document
          const bomDocRef = admin.firestore()
            .collection('projects')
            .doc(projectId)
            .collection('bom')
            .doc('data');

          const bomDoc = await bomDocRef.get();

          if (bomDoc.exists) {
            const bomData = bomDoc.data();
            let updated = false;

            // Find and update the item in categories
            if (bomData.categories && Array.isArray(bomData.categories)) {
              for (const category of bomData.categories) {
                if (category.items && Array.isArray(category.items)) {
                  const itemIndex = category.items.findIndex(item => item.id === bomItemId);
                  if (itemIndex !== -1) {
                    category.items[itemIndex].specificationUrl = n8nResult.specificationUrl;
                    category.items[itemIndex].updatedAt = new Date().toISOString();
                    updated = true;
                    break;
                  }
                }
              }
            }

            if (updated) {
              await bomDocRef.update({
                categories: bomData.categories,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              logger.info('Updated BOM item with spec URL', {
                bomItemId,
                specificationUrl: n8nResult.specificationUrl
              });
            }
          }
        } catch (firestoreError) {
          logger.error('Error updating Firestore:', firestoreError);
          // Don't fail the whole request, just log the error
        }
      }

      // Return success response
      response.status(200).json({
        success: true,
        searchId,
        status: 'completed',
        specificationUrl: n8nResult.specificationUrl || null,
        message: n8nResult.specificationUrl
          ? 'Spec sheet found and saved!'
          : 'Search completed but no spec sheet found.'
      });

    } catch (error) {
      logger.error('Error triggering spec search:', error);
      response.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  }
);

// ==================== BOM STATUS DIGEST FUNCTIONS ====================

/**
 * Generate HTML email for BOM status digest
 */
const generateBOMDigestEmailHTML = ({
  projectName,
  clientName,
  clientLogo,
  companyName,
  reportDate,
  summary,
  overdueItems,
  arrivingSoonItems,
  pendingItems,
  recentChanges
}) => {
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getDaysText = (days) => {
    if (days === 1) return '1 day';
    return `${days} days`;
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BOM Status Update</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5;">
  <div style="max-width: 650px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: #1a365d; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
      <h1 style="margin: 0; font-size: 24px;">${companyName}</h1>
      <p style="margin: 5px 0 0 0; opacity: 0.9;">BOM Status Update</p>
    </div>

    <!-- Project Info -->
    <div style="background: white; padding: 20px; border-bottom: 1px solid #e5e7eb;">
      <div style="display: flex; align-items: center; gap: 16px;">
        ${clientLogo ? `
        <div style="flex-shrink: 0;">
          <img src="${clientLogo}" alt="${clientName}" style="max-height: 60px; max-width: 120px; object-fit: contain;" />
        </div>
        ` : ''}
        <div style="flex: 1;">
          <p style="margin: 0;"><strong>Project:</strong> ${projectName}</p>
          <p style="margin: 5px 0 0 0;"><strong>Client:</strong> ${clientName}</p>
          <p style="margin: 5px 0 0 0;"><strong>Report Date:</strong> ${reportDate}</p>
        </div>
      </div>
    </div>

    <!-- Summary Section -->
    <div style="background: white; padding: 20px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #1a365d;">Summary</h2>
      <div style="display: flex; justify-content: space-around; text-align: center;">
        <div style="flex: 1; padding: 10px;">
          <div style="font-size: 28px; font-weight: bold; color: #22c55e;">${summary.received}</div>
          <div style="font-size: 12px; color: #666;">Received</div>
        </div>
        <div style="flex: 1; padding: 10px;">
          <div style="font-size: 28px; font-weight: bold; color: #3b82f6;">${summary.ordered}</div>
          <div style="font-size: 12px; color: #666;">Ordered</div>
        </div>
        <div style="flex: 1; padding: 10px;">
          <div style="font-size: 28px; font-weight: bold; color: #ef4444;">${summary.overdue}</div>
          <div style="font-size: 12px; color: #666;">Overdue</div>
        </div>
        <div style="flex: 1; padding: 10px;">
          <div style="font-size: 28px; font-weight: bold; color: #9ca3af;">${summary.pending}</div>
          <div style="font-size: 12px; color: #666;">Pending</div>
        </div>
      </div>
      <div style="margin-top: 15px; text-align: center;">
        <p style="margin: 0; font-size: 14px; color: #666;">
          Total Items: ${summary.total} | Progress: ${summary.progressPercent}%
        </p>
      </div>
    </div>

    ${overdueItems.length > 0 ? `
    <!-- Overdue Items -->
    <div style="background: #fef2f2; padding: 20px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #991b1b;">Overdue Items (${overdueItems.length})</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background: #fee2e2;">
          <th style="padding: 8px; text-align: left; font-size: 12px;">Item</th>
          <th style="padding: 8px; text-align: left; font-size: 12px;">Expected</th>
          <th style="padding: 8px; text-align: left; font-size: 12px;">Status</th>
        </tr>
        ${overdueItems.map(item => `
        <tr style="border-bottom: 1px solid #fecaca;">
          <td style="padding: 8px; font-size: 13px;">${item.name}</td>
          <td style="padding: 8px; font-size: 13px;">${formatDate(item.expectedArrival)}</td>
          <td style="padding: 8px; font-size: 13px;">
            <span style="background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 12px; font-size: 11px;">
              ${getDaysText(item.daysLate)} late
            </span>
          </td>
        </tr>
        `).join('')}
      </table>
    </div>
    ` : ''}

    ${arrivingSoonItems.length > 0 ? `
    <!-- Arriving Soon -->
    <div style="background: #fffbeb; padding: 20px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #92400e;">Arriving Soon (${arrivingSoonItems.length})</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background: #fef3c7;">
          <th style="padding: 8px; text-align: left; font-size: 12px;">Item</th>
          <th style="padding: 8px; text-align: left; font-size: 12px;">Expected</th>
          <th style="padding: 8px; text-align: left; font-size: 12px;">Days Left</th>
        </tr>
        ${arrivingSoonItems.map(item => `
        <tr style="border-bottom: 1px solid #fde68a;">
          <td style="padding: 8px; font-size: 13px;">${item.name}</td>
          <td style="padding: 8px; font-size: 13px;">${formatDate(item.expectedArrival)}</td>
          <td style="padding: 8px; font-size: 13px;">
            <span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 12px; font-size: 11px;">
              ${getDaysText(item.daysLeft)}
            </span>
          </td>
        </tr>
        `).join('')}
      </table>
    </div>
    ` : ''}

    ${pendingItems.length > 0 ? `
    <!-- Pending Items (Not Ordered) -->
    <div style="background: #f3f4f6; padding: 20px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #4b5563;">Pending Items - Not Yet Ordered (${pendingItems.length})</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background: #e5e7eb;">
          <th style="padding: 8px; text-align: left; font-size: 12px;">Item</th>
          <th style="padding: 8px; text-align: left; font-size: 12px;">Quantity</th>
          <th style="padding: 8px; text-align: left; font-size: 12px;">Category</th>
        </tr>
        ${pendingItems.map(item => `
        <tr style="border-bottom: 1px solid #d1d5db;">
          <td style="padding: 8px; font-size: 13px;">${item.name}${item.make ? ` <span style="color: #6b7280; font-size: 11px;">(${item.make})</span>` : ''}</td>
          <td style="padding: 8px; font-size: 13px;">${item.quantity}</td>
          <td style="padding: 8px; font-size: 13px;">
            <span style="background: #e5e7eb; color: #4b5563; padding: 2px 8px; border-radius: 12px; font-size: 11px;">
              ${item.category || 'Uncategorized'}
            </span>
          </td>
        </tr>
        `).join('')}
      </table>
    </div>
    ` : ''}

    ${(recentChanges.ordered.length > 0 || recentChanges.received.length > 0) ? `
    <!-- Recent Changes -->
    <div style="background: white; padding: 20px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #1a365d;">Changes Since Last Update</h2>

      ${recentChanges.received.length > 0 ? `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #166534;">Received</h3>
        <ul style="margin: 0; padding-left: 20px;">
          ${recentChanges.received.map(item => `
          <li style="margin-bottom: 5px; font-size: 13px;">${item.name} - Received ${formatDate(item.actualArrival)}</li>
          `).join('')}
        </ul>
      </div>
      ` : ''}

      ${recentChanges.ordered.length > 0 ? `
      <div>
        <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #1d4ed8;">Newly Ordered</h3>
        <ul style="margin: 0; padding-left: 20px;">
          ${recentChanges.ordered.map(item => `
          <li style="margin-bottom: 5px; font-size: 13px;">${item.name} - Expected ${formatDate(item.expectedArrival)}</li>
          `).join('')}
        </ul>
      </div>
      ` : ''}
    </div>
    ` : ''}

    <!-- Footer -->
    <div style="background: #f3f4f6; padding: 20px; text-align: center; border-radius: 0 0 8px 8px;">
      <p style="margin: 0; font-size: 12px; color: #666;">
        This is an automated notification from BOM Tracker.
      </p>
      <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">
        To stop receiving these updates, contact your project manager.
      </p>
    </div>
  </div>
</body>
</html>
  `;
};

/**
 * Helper to calculate BOM digest data from categories
 */
const calculateBOMDigestData = (categories, lastNotificationSentAt) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const allItems = categories.flatMap(cat => cat.items || []);
  const components = allItems.filter(item => item.itemType !== 'service');

  // Summary counts
  const received = components.filter(item => item.status === 'received').length;
  const ordered = components.filter(item => item.status === 'ordered').length;
  const pending = components.filter(item => item.status === 'not-ordered').length;
  const total = components.length;

  // Calculate overdue and arriving soon
  const overdueItems = [];
  const arrivingSoonItems = [];

  components.forEach(item => {
    if (item.status === 'ordered' && item.expectedArrival) {
      const expectedDate = new Date(item.expectedArrival);
      expectedDate.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((expectedDate - today) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        overdueItems.push({
          ...item,
          daysLate: Math.abs(diffDays)
        });
      } else if (diffDays <= 7) {
        arrivingSoonItems.push({
          ...item,
          daysLeft: diffDays
        });
      }
    }
  });

  // Sort by urgency
  overdueItems.sort((a, b) => b.daysLate - a.daysLate);
  arrivingSoonItems.sort((a, b) => a.daysLeft - b.daysLeft);

  // Calculate recent changes (since last notification)
  const recentChanges = { ordered: [], received: [] };

  if (lastNotificationSentAt) {
    const lastSentDate = lastNotificationSentAt instanceof Date
      ? lastNotificationSentAt
      : lastNotificationSentAt.toDate();

    components.forEach(item => {
      // Check for newly ordered items
      if (item.status === 'ordered' && item.orderDate) {
        const orderDate = new Date(item.orderDate);
        if (orderDate > lastSentDate) {
          recentChanges.ordered.push(item);
        }
      }

      // Check for newly received items
      if (item.status === 'received' && item.actualArrival) {
        const arrivalDate = new Date(item.actualArrival);
        if (arrivalDate > lastSentDate) {
          recentChanges.received.push(item);
        }
      }
    });
  } else {
    // First notification - show all ordered/received as recent
    recentChanges.ordered = components.filter(item => item.status === 'ordered');
    recentChanges.received = components.filter(item => item.status === 'received');
  }

  const progressPercent = total > 0 ? Math.round((received / total) * 100) : 0;

  // Get pending items (not ordered yet)
  const pendingItems = components.filter(item => item.status === 'not-ordered');

  return {
    summary: {
      total,
      received,
      ordered,
      overdue: overdueItems.length,
      pending,
      progressPercent
    },
    overdueItems,
    arrivingSoonItems,
    pendingItems,
    recentChanges
  };
};

/**
 * Send BOM digest for a single project to all enabled stakeholders
 */
const sendProjectDigest = async (projectId, projectData, prSettings) => {
  const db = admin.firestore();
  const results = { sent: 0, failed: 0, skipped: 0 };

  // Get stakeholders with notifications enabled
  const stakeholdersSnapshot = await db
    .collection('projects')
    .doc(projectId)
    .collection('stakeholders')
    .where('notificationsEnabled', '==', true)
    .get();

  if (stakeholdersSnapshot.empty) {
    logger.info('No enabled stakeholders for project', { projectId });
    return results;
  }

  // Get BOM data
  const bomDocRef = db.collection('projects').doc(projectId).collection('bom').doc('data');
  const bomDoc = await bomDocRef.get();

  if (!bomDoc.exists || !bomDoc.data().categories) {
    logger.info('No BOM data for project', { projectId });
    return results;
  }

  const categories = bomDoc.data().categories;
  const reportDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  // Try to get client logo by looking up client by company name
  let clientLogo = null;
  if (projectData.clientName) {
    try {
      const clientsSnapshot = await db.collection('clients')
        .where('company', '==', projectData.clientName)
        .limit(1)
        .get();
      if (!clientsSnapshot.empty) {
        const clientData = clientsSnapshot.docs[0].data();
        clientLogo = clientData.logo || null;
      }
    } catch (error) {
      logger.warn('Could not fetch client logo', { clientName: projectData.clientName, error: error.message });
    }
  }

  // Send email to each stakeholder
  for (const stakeholderDoc of stakeholdersSnapshot.docs) {
    const stakeholder = stakeholderDoc.data();

    try {
      // Calculate digest data for this stakeholder (uses their lastNotificationSentAt)
      const digestData = calculateBOMDigestData(
        categories,
        stakeholder.lastNotificationSentAt
      );

      // Generate email HTML
      const htmlContent = generateBOMDigestEmailHTML({
        projectName: projectData.projectName,
        clientName: projectData.clientName,
        clientLogo: clientLogo,
        companyName: prSettings.companyName || 'Qualitas Technologies Pvt Ltd',
        reportDate,
        ...digestData
      });

      // Prepare email
      const msg = {
        to: stakeholder.email,
        from: prSettings.fromEmail || 'info@qualitastech.com',
        subject: `[${projectData.projectName}] - BOM Status Update (${reportDate})`,
        html: htmlContent,
        text: stripHtml(htmlContent),
        trackingSettings: {
          clickTracking: { enable: false, enableText: false }
        }
      };

      // Send email
      await sgMail.send(msg);

      // Update lastNotificationSentAt
      await stakeholderDoc.ref.update({
        lastNotificationSentAt: admin.firestore.FieldValue.serverTimestamp()
      });

      results.sent++;

      logger.info('Digest sent to stakeholder', {
        projectId,
        stakeholderEmail: stakeholder.email,
        itemsTotal: digestData.summary.total
      });

    } catch (error) {
      logger.error('Failed to send digest to stakeholder', {
        projectId,
        stakeholderEmail: stakeholder.email,
        error: error.message
      });
      results.failed++;
    }
  }

  return results;
};

/**
 * Daily scheduled function to send BOM status digests
 * Runs at 9:00 AM IST every day
 */
exports.sendDailyBOMDigest = onSchedule(
  {
    schedule: 'every day 09:00',
    timeZone: 'Asia/Kolkata',
    secrets: [sendgridApiKey]
  },
  async (event) => {
    logger.info('Starting daily BOM digest job');
    const startTime = Date.now();
    const db = admin.firestore();

    try {
      // Configure SendGrid
      sgMail.setApiKey(sendgridApiKey.value());

      // Get PR settings for email config
      const prSettingsDoc = await db.collection('settings').doc('purchaseRequest').get();
      const prSettings = prSettingsDoc.exists ? prSettingsDoc.data() : {};

      // Get all active projects
      const projectsSnapshot = await db.collection('projects')
        .where('status', 'in', ['Planning', 'Ongoing', 'Delayed'])
        .get();

      if (projectsSnapshot.empty) {
        logger.info('No active projects found');
        return;
      }

      const results = { projectsProcessed: 0, totalSent: 0, totalFailed: 0 };

      // Process each project
      for (const projectDoc of projectsSnapshot.docs) {
        const projectData = projectDoc.data();
        const projectId = projectDoc.id;

        try {
          const projectResults = await sendProjectDigest(projectId, projectData, prSettings);
          results.projectsProcessed++;
          results.totalSent += projectResults.sent;
          results.totalFailed += projectResults.failed;
        } catch (error) {
          logger.error('Error processing project', { projectId, error: error.message });
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Daily BOM digest job completed', {
        ...results,
        durationMs: duration
      });

    } catch (error) {
      logger.error('Daily BOM digest job failed', { error: error.message });
      throw error;
    }
  }
);

/**
 * Manual trigger to send BOM digest immediately for a project
 * Called from the UI "Send Update Now" button
 */
exports.sendBOMDigestNow = onCall(
  { secrets: [sendgridApiKey] },
  async (request) => {
    const { auth, data } = request;

    if (!auth) {
      throw new Error('Authentication required');
    }

    const { projectId } = data;
    if (!projectId) {
      throw new Error('Project ID is required');
    }

    logger.info('Manual BOM digest triggered', { projectId, userId: auth.uid });

    const db = admin.firestore();

    try {
      // Configure SendGrid
      sgMail.setApiKey(sendgridApiKey.value());

      // Get project data
      const projectDoc = await db.collection('projects').doc(projectId).get();
      if (!projectDoc.exists) {
        throw new Error('Project not found');
      }
      const projectData = projectDoc.data();

      // Get PR settings for email config
      const prSettingsDoc = await db.collection('settings').doc('purchaseRequest').get();
      const prSettings = prSettingsDoc.exists ? prSettingsDoc.data() : {};

      // Send digest
      const results = await sendProjectDigest(projectId, projectData, prSettings);

      logger.info('Manual BOM digest completed', { projectId, results });

      return {
        success: true,
        message: `Digest sent to ${results.sent} stakeholder(s)`,
        ...results
      };

    } catch (error) {
      logger.error('Manual BOM digest failed', { projectId, error: error.message });
      throw new Error(`Failed to send digest: ${error.message}`);
    }
  }
);
