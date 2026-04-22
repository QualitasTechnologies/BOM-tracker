// AI Service for BOM Analysis using Firebase Functions
// This provides secure AI analysis through a backend proxy

// Generate optimized prompts for effective BOM analysis
const generateOptimizedPrompt = (existingMakes: string[], existingCategories: string[]): string => {
  const categoriesList = existingCategories.length > 0
    ? existingCategories.join(', ')
    : 'Vision Systems, Motors & Drives, Sensors, Control Systems, Mechanical, Electrical, Pneumatic, Hydraulic, Tools, Safety, Uncategorized';

  const makesList = existingMakes.length > 0 ? existingMakes.join(', ') : 'none';

  return `You are a BOM (Bill of Materials) extraction expert. Extract ONLY actual line items from the provided text.

SKIP these rows entirely — do NOT include them in output:
- Section/group headers (e.g. "Machine Vision Hardware", "Industrial PC", "Activities - Installation and Commissioning")
- Column header rows (e.g. "Item", "Description", "Daily Rate", "Qty", "Margin", "Selling Price")
- Empty rows with no item name
- Rows where quantity = 0
- Subtotal / total / summary rows (e.g. "Without Buffer", "Final Price", "Total")
- Any row where the name contains only currency symbols (₹, Rs) or formula artifacts

ITEM TYPE:
- itemType = "service" when: row is under an "Activities" section, has a "Daily Rate" column, or describes labor/engineering/installation/commissioning/support/manpower
- itemType = "component" for all physical hardware and parts

MAKE (manufacturer brand):
- Only set make if a brand name is explicitly written in that specific row
- Known brands in our database: ${makesList}
- If the brand is in our list, use the exact name from the list
- If not explicitly mentioned in the row, return null

PRICE:
- For components: use the "Unit Price" or "Unit Price (INR)" column value ONLY — never use "Selling Price" or margin-adjusted prices
- For services: use the "Daily Rate" or "Rate/Day" column value
- Strip currency symbols and commas before returning the number

NAME and DESCRIPTION cleanup:
- Remove leading/trailing quote characters (" ' " ")
- Remove leading ₹ symbols or currency prefixes
- Remove trailing punctuation artifacts
- Keep the text clean and readable

CATEGORIES — map each item to the closest match from: ${categoriesList}

UNIT — choose from: pcs, nos, sets, kg, g, m, mm, cm, sqm, l, ml, hrs, days, lot
- Default: "pcs" for components, "days" for services

Return ONLY this JSON (no markdown fences):
{
  "items": [
    {
      "name": "Clean item name",
      "itemType": "component",
      "make": "Brand Name or null",
      "description": "Clean description",
      "sku": "Part number or null",
      "quantity": 1,
      "price": 100000,
      "category": "Category Name",
      "unit": "pcs"
    }
  ],
  "totalItems": 1
}`;
};


export interface AIAnalysisRequest {
  text: string;
  projectContext?: string;
  existingCategories?: string[];
  existingMakes?: string[];
}

export interface AIAnalysisResponse {
  items: ExtractedBOMItem[];
  totalItems: number;
  processingTime: number;
}

export interface ExtractedBOMItem {
  name: string;
  itemType?: 'component' | 'service';
  make?: string;
  description: string;
  sku?: string;
  quantity: number;
  price?: number;
  category: string;
  unit?: string;
  specifications?: Record<string, string>;
}

// Secure AI analysis using Firebase Functions
export const analyzeBOMWithAI = async (request: AIAnalysisRequest): Promise<AIAnalysisResponse> => {
  const startTime = Date.now();
  
  try {
    // Call our secure Firebase Function instead of OpenAI directly
    // Use the deployed Firebase Function URL
    const functionUrl = 'https://us-central1-visionbomtracker.cloudfunctions.net/analyzeBOM';
    
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: request.text,
        existingCategories: request.existingCategories,
        existingMakes: request.existingMakes,
        prompt: generateOptimizedPrompt(request.existingMakes || [], request.existingCategories || [])
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`AI analysis failed: ${errorData.error || 'Unknown error'}`);
    }

    const data = await response.json();
    
    // Add processing time
    const processingTime = Date.now() - startTime;
    
    return {
      ...data,
      processingTime
    };

  } catch (error) {
    console.error('AI analysis failed:', error);
    
    // Fallback to keyword analysis if AI fails
    console.warn('Falling back to keyword-based analysis');
    return await analyzeBOMWithKeywords(request.text, request.existingMakes);
  }
};

// Fallback keyword-based analysis (when AI is unavailable)
export const analyzeBOMWithKeywords = async (text: string, existingMakes: string[] = []): Promise<AIAnalysisResponse> => {
  const startTime = Date.now();
  
  const lines = text.split('\n').filter(line => line.trim());
  const items: ExtractedBOMItem[] = [];
  const categories = new Set<string>();
  
  // Define category keywords
  const categoryKeywords: Record<string, string[]> = {
    'Vision Systems': ['camera', 'lens', 'vision', 'optical', 'image', 'sensor', 'detector'],
    'Motors & Drives': ['motor', 'drive', 'actuator', 'servo', 'stepper', 'brushless', 'gearbox'],
    'Sensors': ['sensor', 'proximity', 'limit', 'pressure', 'temperature', 'flow', 'level'],
    'Control Systems': ['controller', 'board', 'plc', 'hmi', 'touchscreen', 'display', 'interface'],
    'Mechanical': ['bolt', 'screw', 'nut', 'washer', 'bracket', 'mount', 'housing', 'frame'],
    'Electrical': ['wire', 'cable', 'connector', 'switch', 'relay', 'fuse', 'breaker'],
    'Pneumatic': ['valve', 'cylinder', 'compressor', 'air', 'pneumatic', 'vacuum'],
    'Hydraulic': ['pump', 'valve', 'cylinder', 'hydraulic', 'fluid', 'pressure'],
    'Tools': ['tool', 'drill', 'saw', 'grinder', 'welder', 'cutter'],
    'Safety': ['guard', 'safety', 'emergency', 'stop', 'light', 'alarm']
  };

  const parseNumericValue = (input: string): number | undefined => {
    if (!input) return undefined;
    const normalized = input.replace(/[,\s]/g, '').replace(/[^\d.]/g, '');
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    
    // Skip empty lines and headers
    if (!trimmedLine || 
        trimmedLine.toLowerCase().includes('item') || 
        trimmedLine.toLowerCase().includes('part') ||
        trimmedLine.toLowerCase().includes('description') ||
        trimmedLine.toLowerCase().includes('quantity')) {
      return;
    }

    const serviceKeywords = /(service|engineering|man\s*-?\s*day|manday|manpower|installation|commissioning|consulting|support)/i;
    const isService = serviceKeywords.test(trimmedLine);

    // Try to extract quantity from the line
    const quantityMatch = isService
      ? trimmedLine.match(/(?:qty|quantity|man\s*-?\s*days?|mandays?|days?)\s*[:=]?\s*(\d+(?:\.\d+)?)/i)
      : trimmedLine.match(/(?:qty|quantity)\s*[:=]?\s*(\d+(?:\.\d+)?)/i) || trimmedLine.match(/(\d+(?:\.\d+)?)/);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;

    // Price extraction (rate/unit price/cost)
    const priceMatch = trimmedLine.match(/(?:rate|price|unit\s*price|cost|amount)\s*[:=]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i)
      || trimmedLine.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/i);
    const price = priceMatch ? parseNumericValue(priceMatch[1]) : undefined;

    // Remove quantity from name and clean up
    let name = trimmedLine.replace(/\d+/g, '').replace(/[-\s]+$/, '').trim();
    
    if (name.length > 0) {
      // Determine category based on keywords
      let suggestedCategory = 'Uncategorized';
      let maxMatches = 0;
      
      Object.entries(categoryKeywords).forEach(([category, keywords]) => {
        const matches = keywords.filter(keyword => 
          name.toLowerCase().includes(keyword.toLowerCase())
        ).length;
        
        if (matches > maxMatches) {
          maxMatches = matches;
          suggestedCategory = category;
        }
      });

      categories.add(suggestedCategory);

      // Smart make matching with existing makes
      let matchedMake: string | undefined = undefined;
      
      // Try exact matching first
      for (const existingMake of existingMakes) {
        if (name.toLowerCase().includes(existingMake.toLowerCase())) {
          matchedMake = existingMake;
          break;
        }
      }
      
      // If no exact match, try partial matching
      if (!matchedMake) {
        for (const existingMake of existingMakes) {
          const makeWords = existingMake.toLowerCase().split(' ');
          if (makeWords.some(word => name.toLowerCase().includes(word) && word.length > 3)) {
            matchedMake = existingMake;
            break;
          }
        }
      }

      // Try to extract SKU from the name
      const skuMatch = name.match(/([A-Z0-9-]{3,})/);
      
      items.push({
        name: name,
        itemType: isService ? 'service' : 'component',
        make: matchedMake,
        description: name,
        sku: skuMatch ? skuMatch[1] : undefined,
        quantity,
        price,
        category: suggestedCategory,
        unit: isService ? 'days' : 'pcs'
      });
    }
  });

  const processingTime = Date.now() - startTime;

  return {
    items,
    totalItems: items.length,
    processingTime
  };
};


// Export the main function
export default analyzeBOMWithAI;
