/**
 * GST Verification API Integration (AppyFlow)
 *
 * Used to verify GSTIN and auto-fill vendor details when adding/editing vendors.
 */

// AppyFlow API Configuration
const APPYFLOW_API_URL = 'https://appyflow.in/api/verifyGST';
const APPYFLOW_API_KEY = 'D9hpZ2NsZaRNsomp2HoFV9sezNm1';

// State code to state name mapping (from first 2 digits of GSTIN)
const STATE_CODE_MAP: Record<string, { code: string; name: string }> = {
  '01': { code: '01', name: 'Jammu & Kashmir' },
  '02': { code: '02', name: 'Himachal Pradesh' },
  '03': { code: '03', name: 'Punjab' },
  '04': { code: '04', name: 'Chandigarh' },
  '05': { code: '05', name: 'Uttarakhand' },
  '06': { code: '06', name: 'Haryana' },
  '07': { code: '07', name: 'Delhi' },
  '08': { code: '08', name: 'Rajasthan' },
  '09': { code: '09', name: 'Uttar Pradesh' },
  '10': { code: '10', name: 'Bihar' },
  '11': { code: '11', name: 'Sikkim' },
  '12': { code: '12', name: 'Arunachal Pradesh' },
  '13': { code: '13', name: 'Nagaland' },
  '14': { code: '14', name: 'Manipur' },
  '15': { code: '15', name: 'Mizoram' },
  '16': { code: '16', name: 'Tripura' },
  '17': { code: '17', name: 'Meghalaya' },
  '18': { code: '18', name: 'Assam' },
  '19': { code: '19', name: 'West Bengal' },
  '20': { code: '20', name: 'Jharkhand' },
  '21': { code: '21', name: 'Odisha' },
  '22': { code: '22', name: 'Chhattisgarh' },
  '23': { code: '23', name: 'Madhya Pradesh' },
  '24': { code: '24', name: 'Gujarat' },
  '26': { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  '27': { code: '27', name: 'Maharashtra' },
  '28': { code: '28', name: 'Andhra Pradesh (Old)' },
  '29': { code: '29', name: 'Karnataka' },
  '30': { code: '30', name: 'Goa' },
  '31': { code: '31', name: 'Lakshadweep' },
  '32': { code: '32', name: 'Kerala' },
  '33': { code: '33', name: 'Tamil Nadu' },
  '34': { code: '34', name: 'Puducherry' },
  '35': { code: '35', name: 'Andaman & Nicobar Islands' },
  '36': { code: '36', name: 'Telangana' },
  '37': { code: '37', name: 'Andhra Pradesh' },
  '38': { code: '38', name: 'Ladakh' },
};

// Response types
export interface GSTAddressInfo {
  buildingNumber: string;
  buildingName: string;
  street: string;
  location: string;
  district: string;
  state: string;
  pincode: string;
}

export interface GSTVerificationResult {
  success: boolean;
  error?: string;
  data?: {
    gstin: string;
    tradeName: string;
    legalName: string;
    status: string;
    registrationDate: string;
    businessType: string;
    address: GSTAddressInfo;
    stateCode: string;
    stateName: string;
    formattedAddress: string;
  };
}

/**
 * Verify a GSTIN and get business details from AppyFlow API
 */
export const verifyGSTIN = async (gstNo: string): Promise<GSTVerificationResult> => {
  try {
    // Validate GSTIN format
    const cleanGstNo = gstNo.trim().toUpperCase();
    if (!isValidGSTINFormat(cleanGstNo)) {
      return {
        success: false,
        error: 'Invalid GSTIN format. GSTIN should be 15 characters.',
      };
    }

    // Make API request
    const response = await fetch(
      `${APPYFLOW_API_URL}?key_secret=${APPYFLOW_API_KEY}&gstNo=${cleanGstNo}`
    );

    if (!response.ok) {
      return {
        success: false,
        error: `API request failed: ${response.status}`,
      };
    }

    const data = await response.json();

    // Check for API errors
    if (data.error) {
      return {
        success: false,
        error: data.message || 'GST verification failed',
      };
    }

    // Extract taxpayer info
    const taxpayer = data.taxpayerInfo;
    if (!taxpayer) {
      return {
        success: false,
        error: 'No taxpayer information found',
      };
    }

    // Extract address
    const pradr = taxpayer.pradr?.addr || {};
    const address: GSTAddressInfo = {
      buildingNumber: pradr.bno || '',
      buildingName: pradr.bnm || '',
      street: pradr.st || '',
      location: pradr.loc || '',
      district: pradr.dst || '',
      state: pradr.stcd || '',
      pincode: pradr.pncd || '',
    };

    // Format address as a single string
    const addressParts = [
      address.buildingNumber,
      address.buildingName,
      address.street,
      address.location,
      address.district,
      address.state,
      address.pincode ? `- ${address.pincode}` : '',
    ].filter(Boolean);
    const formattedAddress = addressParts.join(', ').replace(/, ,/g, ',').trim();

    // Get state code from GSTIN (first 2 digits)
    const stateCodeFromGSTIN = cleanGstNo.substring(0, 2);
    const stateInfo = STATE_CODE_MAP[stateCodeFromGSTIN];

    return {
      success: true,
      data: {
        gstin: taxpayer.gstin || cleanGstNo,
        tradeName: taxpayer.tradeNam || '',
        legalName: taxpayer.lgnm || '',
        status: taxpayer.sts || 'Unknown',
        registrationDate: taxpayer.rgdt || '',
        businessType: taxpayer.ctb || '',
        address,
        stateCode: stateCodeFromGSTIN,
        stateName: stateInfo?.name || address.state || 'Unknown',
        formattedAddress,
      },
    };
  } catch (error) {
    console.error('GST verification error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to verify GSTIN',
    };
  }
};

/**
 * Validate GSTIN format (basic validation)
 * Format: 2 digits (state) + 10 chars (PAN) + 1 char (entity) + 1 char (check) + Z + 1 char
 */
export const isValidGSTINFormat = (gstin: string): boolean => {
  if (!gstin || gstin.length !== 15) return false;
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}[Z]{1}[A-Z0-9]{1}$/;
  return gstinRegex.test(gstin.toUpperCase());
};

/**
 * Extract state code from GSTIN
 */
export const getStateFromGSTIN = (gstin: string): { code: string; name: string } | null => {
  if (!gstin || gstin.length < 2) return null;
  const stateCode = gstin.substring(0, 2);
  return STATE_CODE_MAP[stateCode] || null;
};

/**
 * Check if GSTIN is active
 */
export const isGSTINActive = async (gstin: string): Promise<boolean> => {
  const result = await verifyGSTIN(gstin);
  return result.success && result.data?.status === 'Active';
};
