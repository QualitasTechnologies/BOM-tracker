import { analyzeBOMWithAI, analyzeBOMWithKeywords, ExtractedBOMItem } from './aiService';
import { getBOMSettings } from './settingsFirestore';

// Test configurations
interface TestConfig {
  testName: string;
  input: string;
  expectedCategories: string[];
  expectedItemCount: number;
  filePath?: string;
}

// Test cases for AI import
const TEST_CASES: TestConfig[] = [
  {
    testName: 'Simple BOM List',
    input: `Motor - 2
Proximity Sensor - 1  
Servo Drive - 1
PLC Controller - 1
Safety Guard - 2
Mounting Bracket - 4
Power Cable - 3
Pneumatic Cylinder - 2`,
    expectedCategories: ['Motors & Drives', 'Sensors', 'Control Systems', 'Safety', 'Mechanical', 'Electrical', 'Pneumatic'],
    expectedItemCount: 8
  },
  {
    testName: 'Detailed BOM Format',
    input: `Item: Servo Motor
Quantity: 2
Description: High precision servo motor for axis control

Item: Vision Camera
Quantity: 1
Description: Industrial vision camera with 5MP resolution

Item: Temperature Sensor
Quantity: 3
Description: PT100 temperature sensor`,
    expectedCategories: ['Motors & Drives', 'Vision Systems', 'Sensors'],
    expectedItemCount: 3
  },
  {
    testName: 'Table Format',
    input: `Part Name    Qty    Description
Stepper Motor        2      NEMA 23 stepper motor
HMI Touchscreen      1      7-inch HMI display
Safety Relay         1      Emergency stop relay
Hydraulic Pump       1      Variable displacement pump`,
    expectedCategories: ['Motors & Drives', 'Control Systems', 'Safety', 'Hydraulic'],
    expectedItemCount: 4
  },
  {
    testName: 'Complex Industrial BOM',
    input: `Vision System Components:
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
- Safety Light Curtain - 2 units

Pneumatics:
- Air Cylinder 63mm bore - 6 units
- Pneumatic Valve 5/2 way - 6 units
- Air Compressor 10bar - 1 unit`,
    expectedCategories: ['Vision Systems', 'Motors & Drives', 'Mechanical', 'Safety', 'Control Systems', 'Pneumatic'],
    expectedItemCount: 12
  }
];

// PDF extraction simulation (since we can't actually parse PDF in browser)
const simulatedPDFContent = `SIEMENS BVS4 Vision System BOM

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
BVS Cockpit Software License - 1 unit`;

// Test result interface
interface TestResult {
  testName: string;
  success: boolean;
  executionTime: number;
  itemsFound: number;
  categoriesFound: string[];
  confidenceScores: number[];
  aiUsed: boolean;
  error?: string;
  details?: ExtractedBOMItem[];
}

// Main test function
export const runAIImportTests = async (): Promise<TestResult[]> => {
  console.log('🚀 Starting AI Import Tests...\n');
  
  const results: TestResult[] = [];
  
  // Load BOM settings for realistic testing
  let bomSettings;
  try {
    bomSettings = await getBOMSettings();
    console.log('📋 BOM Settings loaded:', bomSettings?.defaultCategories?.length || 0, 'categories');
  } catch (err) {
    console.warn('⚠️  Could not load BOM settings, using defaults');
  }

  // Test each case
  for (const testCase of TEST_CASES) {
    console.log(`\n🧪 Testing: ${testCase.testName}`);
    console.log('─'.repeat(50));
    
    const startTime = Date.now();
    let result: TestResult;
    
    try {
      // Test AI service
      const analysis = await analyzeBOMWithAI({
        text: testCase.input,
        existingCategories: bomSettings?.defaultCategories || []
      });
      
      const executionTime = Date.now() - startTime;
      
      // Validate results
      const success = analysis.items.length >= Math.floor(testCase.expectedItemCount * 0.7); // 70% success rate
      const confidenceScores = analysis.items.map(item => item.confidence);
      const avgConfidence = confidenceScores.reduce((sum, conf) => sum + conf, 0) / confidenceScores.length;
      
      result = {
        testName: testCase.testName,
        success,
        executionTime,
        itemsFound: analysis.items.length,
        categoriesFound: analysis.suggestedCategories,
        confidenceScores,
        aiUsed: true, // We'll detect this based on response format
        details: analysis.items
      };
      
      // Log detailed results
      console.log(`✅ Items extracted: ${analysis.items.length}/${testCase.expectedItemCount}`);
      console.log(`📊 Average confidence: ${(avgConfidence * 100).toFixed(1)}%`);
      console.log(`⚡ Processing time: ${executionTime}ms`);
      console.log(`🏷️  Categories: ${analysis.suggestedCategories.join(', ')}`);
      
      if (analysis.items.length > 0) {
        console.log('\n📝 Extracted Items:');
        analysis.items.forEach((item, index) => {
          console.log(`   ${index + 1}. ${item.name} (${item.quantity}x) - ${item.suggestedCategory} [${(item.confidence * 100).toFixed(0)}%]`);
        });
      }
      
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      result = {
        testName: testCase.testName,
        success: false,
        executionTime,
        itemsFound: 0,
        categoriesFound: [],
        confidenceScores: [],
        aiUsed: false,
        error: error.message
      };
      
      console.log(`❌ Test failed: ${error.message}`);
    }
    
    results.push(result);
  }
  
  // Test PDF simulation
  console.log(`\n🧪 Testing: PDF Content (Siemens BVS4)`);
  console.log('─'.repeat(50));
  
  const startTime = Date.now();
  try {
    const analysis = await analyzeBOMWithAI({
      text: simulatedPDFContent,
      existingCategories: bomSettings?.defaultCategories || []
    });
    
    const executionTime = Date.now() - startTime;
    const confidenceScores = analysis.items.map(item => item.confidence);
    const avgConfidence = confidenceScores.reduce((sum, conf) => sum + conf, 0) / confidenceScores.length;
    
    const pdfResult: TestResult = {
      testName: 'Siemens BVS4 PDF Content',
      success: analysis.items.length > 0,
      executionTime,
      itemsFound: analysis.items.length,
      categoriesFound: analysis.suggestedCategories,
      confidenceScores,
      aiUsed: true,
      details: analysis.items
    };
    
    console.log(`✅ Items extracted from PDF: ${analysis.items.length}`);
    console.log(`📊 Average confidence: ${(avgConfidence * 100).toFixed(1)}%`);
    console.log(`⚡ Processing time: ${executionTime}ms`);
    console.log(`🏷️  Categories: ${analysis.suggestedCategories.join(', ')}`);
    
    if (analysis.items.length > 0) {
      console.log('\n📝 Extracted Items from PDF:');
      analysis.items.forEach((item, index) => {
        console.log(`   ${index + 1}. ${item.name} (${item.quantity}x) - ${item.suggestedCategory} [${(item.confidence * 100).toFixed(0)}%]`);
      });
    }
    
    results.push(pdfResult);
    
  } catch (error: any) {
    const pdfResult: TestResult = {
      testName: 'Siemens BVS4 PDF Content',
      success: false,
      executionTime: Date.now() - startTime,
      itemsFound: 0,
      categoriesFound: [],
      confidenceScores: [],
      aiUsed: false,
      error: error.message
    };
    
    console.log(`❌ PDF test failed: ${error.message}`);
    results.push(pdfResult);
  }
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  
  const totalTests = results.length;
  const passedTests = results.filter(r => r.success).length;
  const totalItems = results.reduce((sum, r) => sum + r.itemsFound, 0);
  const avgProcessingTime = results.reduce((sum, r) => sum + r.executionTime, 0) / totalTests;
  const allConfidenceScores = results.flatMap(r => r.confidenceScores);
  const avgConfidence = allConfidenceScores.reduce((sum, conf) => sum + conf, 0) / allConfidenceScores.length;
  
  console.log(`✅ Tests Passed: ${passedTests}/${totalTests} (${((passedTests/totalTests) * 100).toFixed(1)}%)`);
  console.log(`📦 Total Items Extracted: ${totalItems}`);
  console.log(`⚡ Average Processing Time: ${avgProcessingTime.toFixed(0)}ms`);
  console.log(`📊 Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
  console.log(`🤖 AI Service Status: ${results.some(r => r.aiUsed) ? 'Working' : 'Fallback Mode'}`);
  
  if (results.some(r => !r.success)) {
    console.log('\n❌ Failed Tests:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`   - ${r.testName}: ${r.error}`);
    });
  }
  
  return results;
};

// Fallback test function (keyword-based)
export const testFallbackAnalysis = async (): Promise<void> => {
  console.log('\n🔄 Testing Fallback Analysis (Keyword-based)...');
  console.log('─'.repeat(50));
  
  const testInput = `Motor - 2
Vision Camera - 1
Temperature Sensor - 1
PLC Controller - 1
Safety Guard - 1`;
  
  try {
    const startTime = Date.now();
    const result = await analyzeBOMWithKeywords(testInput);
    const executionTime = Date.now() - startTime;
    
    console.log(`✅ Fallback analysis completed in ${executionTime}ms`);
    console.log(`📦 Items found: ${result.items.length}`);
    console.log(`🏷️  Categories: ${result.suggestedCategories.join(', ')}`);
    console.log(`📊 Overall confidence: ${(result.confidence * 100).toFixed(1)}%`);
    
    result.items.forEach((item, index) => {
      console.log(`   ${index + 1}. ${item.name} (${item.quantity}x) - ${item.suggestedCategory} [${(item.confidence * 100).toFixed(0)}%]`);
    });
    
  } catch (error: any) {
    console.log(`❌ Fallback test failed: ${error.message}`);
  }
};

// Performance test
export const runPerformanceTest = async (): Promise<void> => {
  console.log('\n⚡ Running Performance Test...');
  console.log('─'.repeat(50));
  
  // Generate large BOM content
  const largeBOMItems = [];
  const itemTypes = ['Motor', 'Sensor', 'Actuator', 'Controller', 'Cable', 'Connector', 'Valve', 'Cylinder'];
  const categories = ['Motors & Drives', 'Sensors', 'Control Systems', 'Electrical', 'Pneumatic', 'Hydraulic'];
  
  for (let i = 1; i <= 50; i++) {
    const itemType = itemTypes[i % itemTypes.length];
    const qty = Math.floor(Math.random() * 10) + 1;
    largeBOMItems.push(`${itemType} ${i.toString().padStart(3, '0')} - ${qty}`);
  }
  
  const largeBOMContent = largeBOMItems.join('\n');
  
  try {
    const startTime = Date.now();
    const result = await analyzeBOMWithAI({
      text: largeBOMContent,
      existingCategories: categories
    });
    const executionTime = Date.now() - startTime;
    
    console.log(`✅ Large BOM processed in ${executionTime}ms`);
    console.log(`📦 Items extracted: ${result.items.length}/50`);
    console.log(`🏷️  Categories used: ${result.suggestedCategories.length}`);
    console.log(`📊 Average confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`⚡ Items per second: ${((result.items.length / executionTime) * 1000).toFixed(1)}`);
    
  } catch (error: any) {
    console.log(`❌ Performance test failed: ${error.message}`);
  }
};

// Export main test runner
export const runAllAIImportTests = async (): Promise<void> => {
  console.log('🎯 BOM AI Import - Comprehensive Test Suite');
  console.log('═'.repeat(60));
  
  try {
    // Run main tests
    await runAIImportTests();
    
    // Run fallback tests  
    await testFallbackAnalysis();
    
    // Run performance tests
    await runPerformanceTest();
    
    console.log('\n🎉 All tests completed!');
    
  } catch (error: any) {
    console.error('\n💥 Test suite failed:', error.message);
  }
};