// AI Service for BOM Analysis using Firebase Functions
// This provides secure AI analysis through a backend proxy

export interface AIAnalysisRequest {
  text: string;
  projectContext?: string;
  existingCategories?: string[];
}

export interface AIAnalysisResponse {
  items: ExtractedBOMItem[];
  suggestedCategories: string[];
  totalItems: number;
  confidence: number;
  processingTime: number;
}

export interface ExtractedBOMItem {
  name: string;
  make?: string;
  description: string;
  sku?: string;
  quantity: number;
  suggestedCategory: string;
  confidence: number;
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
        existingCategories: request.existingCategories
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
    return await analyzeBOMWithKeywords(request.text);
  }
};

// Fallback keyword-based analysis (when AI is unavailable)
export const analyzeBOMWithKeywords = async (text: string): Promise<AIAnalysisResponse> => {
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

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    
    // Skip empty lines and headers
    if (!trimmedLine || 
        trimmedLine.toLowerCase().includes('item') || 
        trimmedLine.toLowerCase().includes('part') ||
        trimmedLine.toLowerCase().includes('description') ||
        trimmedLine.toLowerCase().includes('quantity')) {
      return;
    }

    // Try to extract quantity from the line
    const quantityMatch = trimmedLine.match(/(\d+)/);
    const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;

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

      // Calculate confidence based on keyword matches
      const confidence = Math.min(0.9, 0.5 + (maxMatches * 0.1));

      // Try to extract make and SKU from the name
      const makeMatch = name.match(/^([A-Z][A-Za-z]+)\s+(.+)/);
      const skuMatch = name.match(/([A-Z0-9-]{3,})/);
      
      items.push({
        name: makeMatch ? makeMatch[2] : name,
        make: makeMatch ? makeMatch[1] : undefined,
        description: name !== (makeMatch ? makeMatch[2] : name) ? name : '',
        sku: skuMatch ? skuMatch[1] : undefined,
        quantity,
        suggestedCategory,
        confidence,
        unit: 'pcs'
      });
    }
  });

  const processingTime = Date.now() - startTime;

  return {
    items,
    suggestedCategories: Array.from(categories),
    totalItems: items.length,
    confidence: items.length > 0 ? items.reduce((sum, item) => sum + item.confidence, 0) / items.length : 0,
    processingTime
  };
};

// Utility function to improve AI suggestions based on existing BOM data
export const enhanceAISuggestions = (
  suggestions: ExtractedBOMItem[],
  existingCategories: string[],
  existingItems: string[]
): ExtractedBOMItem[] => {
  return suggestions.map(item => {
    // Check if item name already exists
    const isDuplicate = existingItems.some(existing => 
      existing.toLowerCase().includes(item.name.toLowerCase()) ||
      item.name.toLowerCase().includes(existing.toLowerCase())
    );

    // Adjust confidence based on duplicates
    let adjustedConfidence = item.confidence;
    if (isDuplicate) {
      adjustedConfidence *= 0.8; // Reduce confidence for potential duplicates
    }

    // Check if suggested category exists in current BOM
    const categoryExists = existingCategories.includes(item.suggestedCategory);
    if (categoryExists) {
      adjustedConfidence *= 1.1; // Increase confidence for existing categories
    }

    return {
      ...item,
      confidence: Math.min(1.0, adjustedConfidence)
    };
  });
};

// Export the main function
export default analyzeBOMWithAI;
