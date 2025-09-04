import { computeHeuristicScore, createAnalysisPrompt, extractSuspiciousFromHeuristic } from './analysis.js';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function getApiKey() {
  try {
    const result = await chrome.storage.sync.get(['geminiApiKey']);
    return result.geminiApiKey || null;
  } catch (error) {
    console.error('Error getting API key:', error);
    return null;
  }
}
async function analyzeWithGemini(tweetText, apiKey) {
  if (!apiKey) {
    return { error: 'No API key found. Open SlopDetect settings and add your Gemini API key.' };
  }
  const prompt = createAnalysisPrompt(tweetText);
  
  const requestBody = {
    contents: [{
      role: 'user',
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      temperature: 0,
      topK: 1,
      topP: 0.8,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json'
    }
  };

  try {
    const attemptFetch = async (timeoutMs = 20000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': apiKey
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
        return res;
      } finally {
        clearTimeout(timer);
      }
    };

    // Exponential backoff: 3 attempts with increasing delays
    const maxAttempts = 3;
    let response;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        response = await attemptFetch(22000);
        if (response.status !== 429 && response.status < 500) {
          break; // success or client error that shouldn't be retried
        }
      } catch (err) {
        // Network/abort errors: allow retry
        if (attempt === maxAttempts) throw err;
      }
      if (attempt < maxAttempts) {
        const delay = 600 * Math.pow(2, attempt - 1); // 600ms, 1200ms
        await new Promise(r => setTimeout(r, delay));
      }
    }

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.candidates) || data.candidates.length === 0) {
      if (data?.promptFeedback?.blockReason) {
        throw new Error(`Request blocked: ${data.promptFeedback.blockReason}`);
      }
      throw new Error('Empty candidates returned by Gemini API');
    }

    const first = data.candidates[0];
    const parts = first.content?.parts || [];
    let responseText = parts.map(p => p.text).filter(Boolean).join('\n');

    if (!responseText) {
      const inlineJsonPart = parts.find(p => p.inlineData && (p.inlineData.mimeType === 'application/json' || (p.inlineData.mimeType || '').includes('json')));
      if (inlineJsonPart?.inlineData?.data) {
        try {
          responseText = atob(inlineJsonPart.inlineData.data);
        } catch (_) {
        
        }
      }
    }

    if (!responseText) {
      const reason = first.finishReason || data?.promptFeedback?.blockReason || 'UNKNOWN';
      const reasonMap = {
        STOP: 'The model ended normally without returning text.',
        MAX_TOKENS: 'The response hit the token limit.',
        SAFETY: 'The request/response was blocked by safety filters.',
        RECITATION: 'The model blocked content due to recitation policies.',
        OTHER: 'The model ended for an unspecified reason.',
        BLOCK_REASON_UNSPECIFIED: 'Blocked by safety for an unspecified reason.',
        SAFETY: 'Blocked by safety policies.',
        OTHER: 'Blocked for unspecified reason.'
      };
      const friendly = reasonMap[reason] || `Reason: ${reason}`;
      const msg = `No text content in Gemini response. ${friendly}`;
      console.warn('Gemini empty response detail:', { reason, first });
      const heur = computeHeuristicScore(tweetText);
      const ext = extractSuspiciousFromHeuristic(tweetText);
      return {
        aiScore: heur.score,
        confidence: heur.confidence,
        suspiciousWords: ext.suspiciousWords,
        analysis: {
          tone: 'Heuristic fallback used due to empty model response',
          patterns: heur.reasons.join(', ') || 'N/A',
          content: 'Model returned empty content'
        },
        suspiciousLines: ext.suspiciousLines,
        reasoning: msg
      };
    }
    
    try {
      let analysisResult;
      try {
        analysisResult = JSON.parse(responseText);
      } catch (_) {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON found in response');
        }
        analysisResult = JSON.parse(jsonMatch[0]);
      }
      
      if (typeof analysisResult.aiScore !== 'number' || 
          typeof analysisResult.confidence !== 'number') {
        throw new Error('Invalid analysis result format');
      }
      
      analysisResult.aiScore = Math.max(0, Math.min(100, Math.round(analysisResult.aiScore)));
      analysisResult.confidence = Math.max(0, Math.min(100, Math.round(analysisResult.confidence)));
      
      if (!Array.isArray(analysisResult.suspiciousWords)) {
        analysisResult.suspiciousWords = [];
      }
      if (!Array.isArray(analysisResult.suspiciousLines)) {
        analysisResult.suspiciousLines = [];
      }
  
      const heur = computeHeuristicScore(tweetText);
      const modelConf = Number.isFinite(analysisResult.confidence) ? analysisResult.confidence : 50;
      const heurConf = heur.confidence;

      // Evidence strength from model output
      const modelEvidence = (Array.isArray(analysisResult.suspiciousWords) ? analysisResult.suspiciousWords.length : 0)
        + (Array.isArray(analysisResult.suspiciousLines) ? analysisResult.suspiciousLines.length : 0);
      const weakModelEvidence = modelEvidence < 2; // few or no highlights returned

      // Disagreement magnitude
      const disagreement = Math.abs(analysisResult.aiScore - heur.score);

      // Base weights from confidences
      let mW = Math.max(0.15, Math.min(0.85, modelConf / 100));
      let hW = Math.max(0.15, Math.min(0.85, heurConf / 100));

      // If model is mid-range and weak on evidence, bias towards heuristic a bit
      const modelMid = analysisResult.aiScore >= 30 && analysisResult.aiScore <= 55;
      if (weakModelEvidence && modelMid) {
        hW += 0.15;
        mW -= 0.15;
      }

      // If strong disagreement, pull weights closer to 0.5/0.5 to avoid sticky midpoints
      if (disagreement >= 20) {
        const adj = Math.min(0.2, (disagreement - 20) / 100);
        const avg = (mW + hW) / 2;
        mW = avg - adj / 2;
        hW = avg + adj / 2;
      }

      // Normalize
      const sum = mW + hW;
      const wm = mW / sum;
      const wh = hW / sum;

      const modelRawScore = analysisResult.aiScore;
      const blended = wm * modelRawScore + wh * heur.score;
      analysisResult.aiScore = Math.round(Math.max(0, Math.min(100, blended)));
      analysisResult.confidence = Math.round(Math.max(10, Math.min(95, (modelConf * wm + heurConf * wh))));

      // Attach explanation with evidence used in scoring for UI breakdown
      analysisResult.explain = {
        model: {
          score: modelRawScore,
          confidence: modelConf,
          evidenceCount: modelEvidence
        },
        heuristic: {
          score: heur.score,
          confidence: heurConf,
          reasons: heur.reasons,
          aiEvidence: heur.aiEvidence,
          humanEvidence: heur.humanEvidence
        },
        blend: {
          blended: analysisResult.aiScore,
          weights: { model: Number(wm.toFixed(2)), heuristic: Number(wh.toFixed(2)) },
          disagreement
        }
      };

     
      if ((!analysisResult.suspiciousWords || analysisResult.suspiciousWords.length === 0) ||
          (!analysisResult.suspiciousLines || analysisResult.suspiciousLines.length === 0)) {
        const ext = extractSuspiciousFromHeuristic(tweetText);
        if (!Array.isArray(analysisResult.suspiciousWords) || analysisResult.suspiciousWords.length === 0) {
          analysisResult.suspiciousWords = ext.suspiciousWords;
        }
        if (!Array.isArray(analysisResult.suspiciousLines) || analysisResult.suspiciousLines.length === 0) {
          analysisResult.suspiciousLines = ext.suspiciousLines;
        }
      }
      return analysisResult;
      
    } catch (parseError) {
      console.error('Error parsing Gemini response:', parseError);
      
      try {
        const repairBody = {
          contents: [{
            role: 'user',
            parts: [{
              text: `You will receive a model output that was supposed to be a single JSON object with this schema:\n\n{\n  "aiScore": 0,\n  "confidence": 0,\n  "suspiciousWords": [ { "word": "", "reason": "" } ],\n  "analysis": { "tone": "", "patterns": "", "content": "" },\n  "suspiciousLines": [ { "text": "", "reason": "" } ],\n  "reasoning": ""\n}\n\nReturn ONLY a corrected JSON object that strictly matches this schema. Do not include any prose or code fences. Here is the original text to fix:\n\n${responseText}`
            }]
          }],
          generationConfig: {
            temperature: 0,
            topK: 1,
            topP: 0.9,
            maxOutputTokens: 512,
            responseMimeType: 'application/json'
          }
        };

        const repairRes = await fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': apiKey
          },
          body: JSON.stringify(repairBody)
        });

        if (repairRes.ok) {
          const repairData = await repairRes.json();
          const cand = Array.isArray(repairData.candidates) ? repairData.candidates[0] : null;
          const repairedText = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') || '';
          if (repairedText) {
            const repaired = JSON.parse(repairedText);
            if (typeof repaired.aiScore === 'number' && typeof repaired.confidence === 'number') {
              if (!Array.isArray(repaired.suspiciousWords)) repaired.suspiciousWords = [];
              if (!Array.isArray(repaired.suspiciousLines)) repaired.suspiciousLines = [];
             
              if (repaired.suspiciousWords.length === 0 || repaired.suspiciousLines.length === 0) {
                const extH = extractSuspiciousFromHeuristic(tweetText);
                if (repaired.suspiciousWords.length === 0) repaired.suspiciousWords = extH.suspiciousWords;
                if (repaired.suspiciousLines.length === 0) repaired.suspiciousLines = extH.suspiciousLines;
              }
              repaired.aiScore = Math.max(0, Math.min(100, Math.round(repaired.aiScore)));
              repaired.confidence = Math.max(0, Math.min(100, Math.round(repaired.confidence)));
              return repaired;
            }
          }
        }
      } catch (repairError) {
        console.warn('Repair attempt failed:', repairError);
      }

      const heur = computeHeuristicScore(tweetText);
      const ext = extractSuspiciousFromHeuristic(tweetText);
      return {
        aiScore: heur.score,
        confidence: heur.confidence,
        suspiciousWords: ext.suspiciousWords,
        analysis: {
          tone: 'Heuristic fallback after parse failures',
          patterns: heur.reasons.join(', ') || 'N/A',
          content: 'Could not process model response'
        },
        suspiciousLines: ext.suspiciousLines,
        reasoning: 'Used heuristic estimator due to primary and repair parse failures'
      };
    }
    
  } catch (error) {
    console.error('Gemini API error:', error);
    
    if (error.message.includes('API_KEY_INVALID') || error.message.includes('403')) {
      return { error: 'Invalid API key. Please check your Gemini API key in settings.' };
    } else if (error.message.includes('QUOTA_EXCEEDED')) {
      return { error: 'API quota exceeded. Please try again later or check your billing.' };
    } else if (error.message.includes('RATE_LIMIT_EXCEEDED')) {
      return { error: 'Rate limit exceeded. Please wait a moment and try again.' };
    } else {
      return { error: `Analysis failed: ${error.message}` };
    }
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeTweet') {
    (async () => {
      try {
        const apiKey = await getApiKey();
        const result = await analyzeWithGemini(request.text, apiKey);
        sendResponse(result);
      } catch (error) {
        console.error('Background script error:', error);
        sendResponse({ error: 'Internal error occurred' });
      }
    })();
    return true;
  }
  
  if (request.action === 'saveApiKey') {
    chrome.storage.sync.set({ geminiApiKey: request.apiKey }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'getApiKey') {
    (async () => {
      const apiKey = await getApiKey();
      sendResponse({ apiKey: apiKey });
    })();
    return true;
  }

  if (request.action === 'openOptions') {
    chrome.runtime.openOptionsPage(() => {
      sendResponse({ opened: true });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('SlopDetect extension installed');
});
