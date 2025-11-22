# AI BOM Import Setup Guide

## Overview
This guide explains how to set up the AI-powered BOM import feature using OpenAI's GPT-4o-mini model.

## Prerequisites
- OpenAI API account with credits
- API key from OpenAI platform

## Setup Steps

### 1. Get OpenAI API Key
1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy the API key (starts with `sk-...`)

### 2. Configure Environment Variables
Create a `.env` file in your project root:

```bash
# .env
REACT_APP_OPENAI_API_KEY=sk-your_actual_api_key_here
```

**Important**: 
- The variable MUST start with `REACT_APP_` for Vite to recognize it
- Never commit your `.env` file to version control
- Add `.env` to your `.gitignore` file

### 3. Restart Development Server
After adding the environment variable, restart your development server:

```bash
npm run dev
# or
yarn dev
```

## How It Works

### AI Analysis Process
1. **Text Extraction**: Converts uploaded documents or pasted text to plain text
2. **AI Processing**: Sends text to OpenAI GPT-4o-mini for analysis
3. **Structured Output**: AI returns JSON with extracted BOM items
4. **Category Mapping**: Maps AI suggestions to existing BOM categories
5. **Import**: Adds items to your project BOM

### AI Prompt Structure
The system sends a carefully crafted prompt to GPT-4o-mini:

```
You are an expert BOM (Bill of Materials) analyst. Your task is to analyze BOM text and extract structured data.

ANALYSIS REQUIREMENTS:
1. Extract part names, quantities, and descriptions
2. Suggest appropriate categories based on part characteristics
3. Provide confidence scores (0.0 to 1.0) for each extraction
4. Handle various BOM formats (lists, tables, structured text)
5. Use existing categories when possible, suggest new ones when needed

OUTPUT FORMAT (JSON only):
{
  "items": [
    {
      "name": "Part name",
      "description": "Part description",
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
```

## Cost Estimation

### GPT-4o-mini Pricing (as of 2024)
- **Input**: $0.15 per 1M tokens
- **Output**: $0.60 per 1M tokens

### Typical BOM Analysis Costs
- **Small BOM** (10-20 items): ~$0.001-0.005 per analysis
- **Medium BOM** (50-100 items): ~$0.005-0.02 per analysis
- **Large BOM** (200+ items): ~$0.02-0.05 per analysis

### Cost Optimization Tips
1. **Batch Processing**: Import multiple BOMs in one session
2. **Text Cleanup**: Remove unnecessary headers/footers before analysis
3. **Category Reuse**: Use existing categories to reduce AI processing

## Error Handling

### Fallback Behavior
If AI analysis fails, the system automatically falls back to keyword-based analysis:
- Uses predefined category keywords
- Provides basic text parsing
- Maintains functionality even without AI

### Common Error Scenarios
1. **API Key Missing**: Check `.env` file and restart server
2. **API Rate Limits**: Wait and retry, or upgrade OpenAI plan
3. **Invalid Response**: System falls back to keyword analysis
4. **Network Issues**: Check internet connection and retry

## Security Considerations

### API Key Protection
- ✅ Environment variables (not in code)
- ✅ Client-side only (no server required)
- ✅ Rate limiting built-in
- ⚠️ Key visible in browser dev tools

### Best Practices
1. **Rotate Keys**: Regularly update your API key
2. **Monitor Usage**: Check OpenAI dashboard for unusual activity
3. **Limit Access**: Don't share API keys
4. **Budget Alerts**: Set spending limits in OpenAI dashboard

## Testing

### Test Your Setup
1. Create a `.env` file with your API key
2. Restart the development server
3. Go to any project's BOM page
4. Click "Import BOM" button
5. Paste some test BOM text
6. Click "Analyze with AI"
7. Verify AI analysis works

### Test Data Example
```
Motor - 2
Sensor - 1
Bracket - 4
Control Board - 1
```

## Troubleshooting

### API Key Issues
```bash
# Check if environment variable is loaded
console.log(process.env.REACT_APP_OPENAI_API_KEY)

# Should show your API key (not undefined)
```

### Common Problems
1. **"API key not found"**: Check `.env` file and restart server
2. **"OpenAI API error"**: Verify API key and account credits
3. **"Invalid response"**: AI returned malformed JSON (fallback should work)
4. **"Rate limit exceeded"**: Wait and retry, or upgrade plan

### Debug Mode
Enable console logging to see API calls:
```typescript
// In aiService.ts, add:
console.log('API Request:', request);
console.log('API Response:', data);
```

## Support

### OpenAI Support
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [OpenAI Help Center](https://help.openai.com/)
- [OpenAI Community](https://community.openai.com/)

### Application Support
- Check browser console for error messages
- Verify environment variable configuration
- Test with simple BOM text first
- Use fallback keyword analysis if AI fails

---

**Note**: This feature requires an active OpenAI API key and internet connection. The system gracefully falls back to keyword-based analysis if AI services are unavailable.
