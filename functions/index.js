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
const logger = require("firebase-functions/logger");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");

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
        unitPrice: item.finalizedVendor?.price || null
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
        text: stripHtml(htmlContent)
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
const pdfParse = require('pdf-parse');

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

