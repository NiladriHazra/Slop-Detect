# SlopDetect

A Chrome extension that detects AI-generated tweets on Twitter/X using advanced AI analysis.

## Features

- **Real-time AI Detection**: Click the "AI Check" button on any tweet to analyze it
- **Smart Highlighting**: Suspicious phrases are highlighted with explanatory tooltips
- **Confidence Scoring**: Get a 0-100% AI Slop score with confidence rating
- **Modern UI**: Sleek design with cyan spotlight background
- **Comprehensive Analysis**: Analyzes tone, special characters, and writing patterns
- **Settings Management**: Configure API keys and detection sensitivity
- **Usage Statistics**: Track your detection history

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the SlopDetect folder
5. The extension will appear in your Chrome toolbar

## Setup

1. Get a free Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click the SlopDetect extension icon in your toolbar
3. Click the settings button (gear icon)
4. Enter your API key in the settings page
5. Configure your preferences and save

## Usage

1. Navigate to Twitter/X (twitter.com or x.com)
2. Find any tweet you want to analyze
3. Look for the "AI Check" button in the tweet's action bar
4. Click the button to start analysis
5. View the AI Slop score and highlighted suspicious phrases
6. Hover over highlighted text to see explanations

## How It Works

SlopDetect analyzes tweets for various AI-generated indicators:

### Tone Analysis
- Overly formal or robotic language
- Unnatural enthusiasm or positivity
- Generic motivational language
- Lack of personal voice

### Linguistic Patterns
- Overuse of certain punctuation (—, ", etc.)
- Repetitive sentence structures
- Buzzwords and corporate speak
- Perfect grammar without natural imperfections

### Content Characteristics
- Generic advice or platitudes
- Lack of specific personal details
- Overly structured thoughts
- Missing cultural context or slang

### Suspicious Phrases
- "I've learned that..."
- "Here's the thing..."
- "Let me share..."
- "The key is..."
- Corporate buzzwords

## Settings

Access settings by clicking the gear icon in the extension popup:

- **API Key Management**: Add your own Gemini API key
- **Detection Sensitivity**: Adjust how aggressive the detection should be
- **Auto-highlighting**: Toggle automatic phrase highlighting
- **Tooltips**: Enable/disable explanatory tooltips
- **Statistics**: Control usage data collection

## Privacy

- Your API key is stored securely in your browser
- No personal data is collected or transmitted
- Analysis is performed using Google's Gemini API
- Usage statistics are stored locally (optional)

## Technical Details

### Files Structure
```
SlopDetect/
├── manifest.json       # Extension configuration
├── background.js       # Service worker for API communication
├── content.js         # Main content script for Twitter integration
├── content.css        # Styling for injected elements
├── popup.html         # Extension popup interface
├── popup.css          # Popup styling
├── popup.js           # Popup functionality
├── options.html       # Settings page
├── options.css        # Settings page styling
├── options.js         # Settings functionality
└── README.md          # This file
```

### API Integration
- Uses Google's Gemini Pro model for analysis
- Sends tweet text for comprehensive AI detection
- Returns structured analysis with scores and explanations

### Browser Compatibility
- Chrome (Manifest V3)
- Edge (Chromium-based)
- Other Chromium-based browsers

## Troubleshooting

### Common Issues

**Extension not working on Twitter/X**
- Refresh the page after installing the extension
- Make sure you're on twitter.com or x.com
- Check that the extension is enabled

**API errors**
- Verify your Gemini API key is correct
- Check your API quota and billing status
- Try using the default API key fallback option

**No AI Check button appearing**
- Wait a moment for tweets to load completely
- Try scrolling to load more tweets
- Check browser console for any errors

**Analysis taking too long**
- Check your internet connection
- Verify API key is working
- Try refreshing the page

### Getting Help

If you encounter issues:
1. Check the browser console for error messages
2. Verify your API key in settings
3. Try clearing extension data in settings
4. Reload the extension in chrome://extensions/

## Contributing

This extension is designed to help users identify potentially AI-generated content on social media platforms. Contributions and improvements are welcome.

## License

This project is provided as-is for educational and research purposes.

## Version History

### v1.0.0
- Initial release
- Real-time AI detection
- Smart highlighting
- Settings management
- Usage statistics
- Modern UI with cyan spotlight theme
# Slop-Detect
