// Standalone test script for AI Import functionality
// This simulates the AI service without browser dependencies

// Mock environment for OpenAI API key
process.env.REACT_APP_OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY || 'test-key';

// Simulated AI service for testing
const simulateAIAnalysis = async (text, existingCategories = []) => {
  const startTime = Date.now();
  
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
  
  // Parse text into lines
  const lines = text.split('\n').filter(line => line.trim());
  const items = [];
  const categories = new Set();
  
  // Category keywords for fallback
  const categoryKeywords = {
    'Vision Systems': ['camera', 'lens', 'vision', 'optical', 'image', 'detector', 'bvs'],
    'Motors & Drives': ['motor', 'drive', 'actuator', 'servo', 'stepper', 'brushless'],
    'Sensors': ['sensor', 'proximity', 'limit', 'pressure', 'temperature', 'pt100'],
    'Control Systems': ['controller', 'board', 'plc', 'hmi', 'touchscreen', 'display'],
    'Mechanical': ['bolt', 'screw', 'nut', 'washer', 'bracket', 'mount', 'housing'],
    'Electrical': ['wire', 'cable', 'connector', 'switch', 'relay', 'power', 'terminal'],
    'Pneumatic': ['valve', 'cylinder', 'compressor', 'air', 'pneumatic'],
    'Safety': ['guard', 'safety', 'emergency', 'stop', 'light', 'curtain'],
    'Hydraulic': ['pump', 'hydraulic', 'fluid'],
    'Software': ['software', 'license', 'cockpit', 'configuration']
  };
  
  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    
    // Skip headers and empty lines
    if (!trimmedLine || 
        trimmedLine.toLowerCase().includes('component') ||
        trimmedLine.toLowerCase().includes('hardware') ||
        trimmedLine.toLowerCase().includes('electrical') ||
        trimmedLine.toLowerCase().includes('main') ||
        trimmedLine.toLowerCase().includes('mounting') ||
        trimmedLine.toLowerCase().includes('configuration') ||
        trimmedLine.includes('---') ||
        trimmedLine.includes('===')) {
      return;
    }
    
    // Extract quantity and name
    let quantity = 1;
    let name = trimmedLine;
    
    // Try different quantity patterns
    const quantityPatterns = [
      /(\d+)\s*units?/i,
      /(\d+)\s*unit/i,
      /(\d+)x/i,
      /-\s*(\d+)(?:\s|$)/,
      /:\s*(\d+)(?:\s|$)/,
      /(\d+)\s*meters?/i,
      /x\s*(\d+)/i
    ];
    
    for (const pattern of quantityPatterns) {
      const match = trimmedLine.match(pattern);
      if (match) {
        quantity = parseInt(match[1]);
        name = trimmedLine.replace(pattern, '').replace(/[-:]\s*$/, '').trim();
        break;
      }
    }
    
    // Clean up name
    name = name.replace(/^[-•*]\s*/, ''); // Remove bullet points
    name = name.replace(/\s*[-:]\s*$/, ''); // Remove trailing separators
    name = name.replace(/\s+/g, ' ').trim(); // Normalize spaces
    
    if (name.length < 3) return; // Skip very short names
    
    // Determine category
    let suggestedCategory = 'Uncategorized';
    let maxMatches = 0;
    let confidence = 0.5;
    
    Object.entries(categoryKeywords).forEach(([category, keywords]) => {
      const matches = keywords.filter(keyword => 
        name.toLowerCase().includes(keyword.toLowerCase())
      ).length;
      
      if (matches > maxMatches) {
        maxMatches = matches;
        suggestedCategory = category;
        confidence = Math.min(0.95, 0.6 + (matches * 0.1));
      }
    });
    
    categories.add(suggestedCategory);
    
    items.push({
      name,
      description: `Extracted from line ${index + 1}`,
      quantity,
      suggestedCategory,
      confidence,
      unit: name.toLowerCase().includes('meter') ? 'm' : 'pcs'
    });
  });
  
  const processingTime = Date.now() - startTime;
  const overallConfidence = items.length > 0 ? 
    items.reduce((sum, item) => sum + item.confidence, 0) / items.length : 0;
  
  return {
    items,
    suggestedCategories: Array.from(categories),
    totalItems: items.length,
    confidence: overallConfidence,
    processingTime
  };
};

// Test configurations
const TEST_CASES = [
  {
    name: 'Simple BOM List',
    input: `Motor - 2
Proximity Sensor - 1  
Servo Drive - 1
PLC Controller - 1
Safety Guard - 2
Mounting Bracket - 4
Power Cable - 3
Pneumatic Cylinder - 2`
  },
  {
    name: 'Siemens BVS4 Vision System',
    input: `SIEMENS BVS4 Vision System BOM

Main Components:
Smart Camera BVS0004 - 1 unit
Industrial Lens C-Mount 16mm - 1 unit  
LED Illumination Ring White - 1 unit
Ethernet Cable CAT6 - 1 unit

Mounting Hardware:
Camera Mounting Bracket - 1 unit
M6 Bolts x 25mm - 4 units
Washers M6 - 4 units

Electrical:
24V Power Supply 60W - 1 unit
Terminal Block 8-way - 1 unit
Shielded Cable 4-core - 2 meters

Configuration Software:
BVS Cockpit Software License - 1 unit`
  },
  {
    name: 'Complex Industrial System',
    input: `Industrial Automation Line BOM

Vision Systems:
- Industrial Camera 5MP - 2 units
- Telecentric Lens 75mm - 2 units  
- LED Ring Light - 2 units

Motion Control:
- Servo Motor 1kW - 4 units
- Servo Drive 1.5kW - 4 units
- Linear Actuator 500mm - 2 units

Safety Systems:
- Safety PLC - 1 unit
- Emergency Stop Button - 3 units
- Safety Light Curtain - 2 units`
  }
];

// Main test function
const runTests = async () => {
  console.log('🎯 BOM AI Import - Backend Test Suite');
  console.log('═'.repeat(60));
  
  const results = [];
  let totalItems = 0;
  let totalTime = 0;
  
  for (const testCase of TEST_CASES) {
    console.log(`\n🧪 Testing: ${testCase.name}`);
    console.log('─'.repeat(50));
    
    try {
      const result = await simulateAIAnalysis(testCase.input);
      
      console.log(`✅ Items extracted: ${result.items.length}`);
      console.log(`📊 Average confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`⚡ Processing time: ${result.processingTime}ms`);
      console.log(`🏷️  Categories: ${result.suggestedCategories.join(', ')}`);
      
      if (result.items.length > 0) {
        console.log('\n📝 Extracted Items:');
        result.items.forEach((item, index) => {
          console.log(`   ${index + 1}. ${item.name} (${item.quantity}x) - ${item.suggestedCategory} [${(item.confidence * 100).toFixed(0)}%]`);
        });
      }
      
      results.push({
        name: testCase.name,
        success: true,
        items: result.items.length,
        time: result.processingTime,
        confidence: result.confidence
      });
      
      totalItems += result.items.length;
      totalTime += result.processingTime;
      
    } catch (error) {
      console.log(`❌ Test failed: ${error.message}`);
      results.push({
        name: testCase.name,
        success: false,
        error: error.message
      });
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  
  const successfulTests = results.filter(r => r.success).length;
  const avgTime = totalTime / results.length;
  const avgConfidence = results
    .filter(r => r.confidence)
    .reduce((sum, r) => sum + r.confidence, 0) / results.filter(r => r.confidence).length;
  
  console.log(`✅ Tests Passed: ${successfulTests}/${results.length}`);
  console.log(`📦 Total Items Extracted: ${totalItems}`);
  console.log(`⚡ Average Processing Time: ${avgTime.toFixed(0)}ms`);
  console.log(`📊 Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
  
  // Test specific scenarios
  console.log('\n🔬 Scenario-Specific Tests:');
  console.log('─'.repeat(30));
  
  // Test 1: Empty input
  try {
    const emptyResult = await simulateAIAnalysis('');
    console.log(`✅ Empty input handled: ${emptyResult.items.length} items`);
  } catch (error) {
    console.log(`❌ Empty input failed: ${error.message}`);
  }
  
  // Test 2: Invalid format
  try {
    const invalidResult = await simulateAIAnalysis('This is just random text with no BOM data');
    console.log(`✅ Invalid format handled: ${invalidResult.items.length} items`);
  } catch (error) {
    console.log(`❌ Invalid format failed: ${error.message}`);
  }
  
  // Test 3: Mixed formats
  try {
    const mixedResult = await simulateAIAnalysis(`Motor: 2 units
Sensor - 1
Cable (3 pieces)
Controller x1`);
    console.log(`✅ Mixed formats handled: ${mixedResult.items.length} items`);
  } catch (error) {
    console.log(`❌ Mixed formats failed: ${error.message}`);
  }
  
  console.log('\n🎉 All tests completed!');
  console.log('\n💡 To test with real PDF content:');
  console.log('   1. Extract text from C:\\Users\\rkash\\Downloads\\Siemens-BVS4.pdf.pdf');
  console.log('   2. Replace simulatedContent with actual PDF text');
  console.log('   3. Run this script again');
};

// Run the tests
runTests().catch(console.error);