# AI-Based BOM Import Feature Guide

## Overview
The AI-based BOM import feature allows you to quickly import Bill of Materials (BOM) items into your projects by uploading documents or pasting text. The system uses **OpenAI GPT-4o-mini** for intelligent analysis to automatically categorize and structure your BOM data.

## Features

### 1. Document Upload
- **Supported Formats**: PDF, DOCX, TXT
- **File Size Limit**: 10MB
- **Drag & Drop**: Simply drag files onto the upload area
- **Browse**: Click to select files from your computer

### 2. Text Input
- **Direct Pasting**: Paste BOM content directly into the text area
- **Format Flexibility**: Handles various text formats and structures
- **Real-time Processing**: Immediate analysis of pasted content

### 3. AI Analysis
- **Smart Categorization**: Uses OpenAI GPT-4o-mini to suggest categories based on part characteristics
- **Quantity Extraction**: AI identifies quantities from various text patterns and formats
- **Confidence Scoring**: Provides AI-generated confidence levels for each extraction
- **Intelligent Parsing**: Handles complex BOM formats with natural language understanding

### 4. Category Mapping
- **AI Suggestions**: System suggests categories based on part characteristics
- **Custom Mapping**: Map AI suggestions to existing BOM categories
- **New Categories**: Create new categories on-the-fly
- **Bulk Operations**: Apply category changes to multiple items

### 5. Import Preview
- **Item Review**: Preview all extracted items before importing
- **Data Validation**: Check quantities, names, and categories
- **Edit Capabilities**: Modify items before final import
- **Confidence Indicators**: See how confident the AI is about each extraction

## How to Use

### Step 1: Access Import Feature
1. Navigate to any project's BOM page
2. Click the **"Import BOM"** button (next to "Add Part")
3. The Import BOM dialog will open

### Step 2: Choose Input Method
- **Upload Tab**: Drag and drop files or browse to select
- **Text Tab**: Paste your BOM content directly

### Step 3: Process Content
1. Click **"Analyze Content"** to start AI processing
2. Wait for analysis to complete
3. Review the extracted items and suggested categories

### Step 4: Review and Map Categories
1. **Category Mapping**: Map AI suggestions to your existing categories
2. **Item Review**: Check each extracted item for accuracy
3. **Confidence Check**: Review confidence scores for each item

### Step 5: Import
1. Click **"Import [X] Items"** to add items to your BOM
2. Items are automatically added to appropriate categories
3. New categories are created if needed
4. Success notification confirms import completion

## Input Format Examples

### Simple List Format
```
Motor - 2
Sensor - 1
Bracket - 4
Control Board - 1
```

### Detailed Format
```
Item: Motor
Quantity: 2
Description: Servo motor for axis control

Item: Sensor
Quantity: 1
Description: Proximity sensor
```

### Table Format (when converted to text)
```
Part Name    Qty    Description
Motor        2      Servo motor
Sensor       1      Proximity sensor
Bracket      4      Mounting bracket
```

## AI Categorization Logic

The system uses OpenAI GPT-4o-mini for intelligent categorization, with fallback to keyword matching if AI is unavailable:

- **Vision Systems**: camera, lens, vision, optical, image, sensor, detector
- **Motors & Drives**: motor, drive, actuator, servo, stepper, brushless, gearbox
- **Sensors**: sensor, proximity, limit, pressure, temperature, flow, level
- **Control Systems**: controller, board, plc, hmi, touchscreen, display, interface
- **Mechanical**: bolt, screw, nut, washer, bracket, mount, housing, frame
- **Electrical**: wire, cable, connector, switch, relay, fuse, breaker
- **Pneumatic**: valve, cylinder, compressor, air, pneumatic, vacuum
- **Hydraulic**: pump, valve, cylinder, hydraulic, fluid, pressure
- **Tools**: tool, drill, saw, grinder, welder, cutter
- **Safety**: guard, safety, emergency, stop, light, alarm

## Best Practices

### For Best Results:
1. **Clear Formatting**: Use consistent formatting for part names and quantities
2. **Descriptive Names**: Include key characteristics in part names
3. **Standard Units**: Use consistent quantity units (pcs, kg, m, etc.)
4. **Category Keywords**: Include relevant keywords in part names for better categorization

### File Preparation:
1. **Convert Complex Formats**: Convert complex documents to simple text when possible
2. **Remove Headers**: Clean up document headers and footers
3. **Standardize Separators**: Use consistent separators (dashes, colons, etc.)
4. **Check Encoding**: Ensure proper text encoding for special characters

## Troubleshooting

### Common Issues:
1. **Low Confidence Scores**: Check if part names contain relevant keywords
2. **Wrong Categories**: Manually map categories during the review step
3. **Missing Quantities**: Ensure quantities are clearly specified in the text
4. **File Format Issues**: Convert unsupported formats to TXT before uploading

### Performance Tips:
1. **Text Input**: Use text input for faster processing of simple BOMs
2. **Batch Processing**: Import large BOMs in smaller chunks for better accuracy
3. **Category Review**: Always review category mappings before importing

## Future Enhancements

The AI import feature is designed to be extensible:

- **Real AI Integration**: Connect to OpenAI, Claude, or other AI services
- **Learning Capabilities**: Improve accuracy based on user corrections
- **Template Support**: Save and reuse import configurations
- **Advanced Parsing**: Better support for complex document formats
- **Multi-language Support**: Handle BOMs in different languages

## Technical Details

### Current Implementation:
- **OpenAI GPT-4o-mini Integration**: Real AI analysis using OpenAI's latest model
- **Intelligent Categorization**: AI understands context and suggests appropriate categories
- **Fallback Processing**: Graceful degradation to keyword analysis if AI fails
- **Real-time Updates**: Immediate feedback during AI processing
- **Error Handling**: Comprehensive error handling with automatic fallback

### Architecture:
- **Frontend**: React component with TypeScript
- **AI Service**: OpenAI GPT-4o-mini API integration with structured prompts
- **Firebase Integration**: Seamless integration with existing BOM system
- **Settings Integration**: Uses existing BOM settings for categories
- **Fallback System**: Automatic fallback to keyword analysis if AI fails

## Setup Requirements

### OpenAI API Configuration
This feature requires an OpenAI API key to function:

1. **Get API Key**: Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. **Create .env File**: Add `REACT_APP_OPENAI_API_KEY=your_key_here`
3. **Restart Server**: Restart development server after adding API key

**Cost**: GPT-4o-mini is very affordable (~$0.001-0.05 per BOM analysis)

### Fallback Mode
If AI is unavailable, the system automatically falls back to keyword-based analysis, ensuring functionality even without API access.

## Support

For issues or questions about the AI import feature:
1. Check this guide for common solutions
2. Review the troubleshooting section
3. Check the `AI_SETUP_README.md` for detailed setup instructions
4. Contact your system administrator
5. Check the application logs for detailed error information

---

*This feature is designed to save time and improve accuracy when importing BOM data. The AI analysis provides intelligent suggestions, but always review the results before importing to ensure data quality.*
