// AI Service for BOM Analysis using Firebase Functions
// This provides secure AI analysis through a backend proxy

// Generate optimized prompts for effective BOM analysis
const generateOptimizedPrompt = (existingMakes: string[], existingCategories: string[]): string => {
  const makesList = existingMakes.length > 0 
    ? `Existing vendor makes in our database: ${existingMakes.join(', ')}\n`
    : '';

  const categoriesList = existingCategories.length > 0
    ? `Preferred categories: ${existingCategories.join(', ')}\n`
    : 'Standard categories: Vision Systems, Motors & Drives, Sensors, Control Systems, Mechanical, Electrical, Pneumatic, Hydraulic, Tools, Safety, Uncategorized\n';

  return `You are a BOM (Bill of Materials) extraction expert. Extract items from the provided text.

INSTRUCTIONS:
1. Extract item names, quantities, pricing, and descriptions
2. Look for manufacturer/brand names (makes) - match to existing: ${existingMakes.join(', ') || 'any recognizable brands'}
3. Assign logical categories: ${existingCategories.join(', ') || 'Vision Systems, Motors & Drives, Sensors, Control Systems, Mechanical, Electrical, Uncategorized'}
4. Extract part numbers/SKUs when visible
5. Detect item type:
   - "component" for physical material/parts
   - "service" for labor/engineering/manpower activities
6. For services, map man-days to quantity (supports decimals like 0.5, 2.5)
7. Extract price:
   - component => unit price (INR)
   - service => rate per day (INR/day)
8. Default unit is "pcs" for components and "days" for services unless explicitly specified

Return JSON with this exact structure:
{
  "items": [
    {
      "name": "Item Name",
      "itemType": "component or service",
      "make": "Brand Name or null",
      "description": "Item description", 
      "sku": "Part number or null",
      "quantity": 1,
      "price": 0,
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
