let isAnalyzing = false;
let analysisResults = new Map();
let ensureTimer = null;

function safeSendMessage(message) {
  return new Promise((resolve) => {
    // If extension was reloaded/unloaded, chrome.runtime.id can be undefined
    if (!chrome.runtime || !chrome.runtime.id) {
      return resolve({ error: 'Extension context invalidated. Please refresh the page and try again.' });
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          const msg = String(lastErr.message || '').toLowerCase();
          if (msg.includes('context invalidated') || msg.includes('extension context invalidated')) {
            return resolve({ error: 'Extension context invalidated. Please refresh the page and try again.' });
          }
          return resolve({ error: 'Communication error' });
        }
        resolve(response);
      });
    } catch (e) {
      return resolve({ error: 'Extension context invalidated. Please refresh the page and try again.' });
    }
  });
}

function createDetectionButton() {
  const button = document.createElement('button');
  button.className = 'slop-detect-btn icon-only';
  button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
    </svg>
    <span>AI Check</span>
  `;
  button.title = 'Check if this tweet is AI-generated';
  return button;
}

function createScoreDisplay(score, confidence) {
  const scoreDiv = document.createElement('div');
  scoreDiv.className = 'slop-score-display';
  
  const scoreColor = score > 70 ? '#ef4444' : score > 40 ? '#f59e0b' : '#10b981';
  
  // Initialize at 0 and animate up later
  scoreDiv.innerHTML = `
    <div class="score-container" data-score="${Number(score) || 0}" data-confidence="${Number(confidence) || 0}">
      <div class="score-bar">
        <div class="score-fill" style="width: 0%; background-color: ${scoreColor}"></div>
      </div>
      <div class="score-text">
        <span class="score-value">0%</span>
        <span class="score-label">AI Slop</span>
      </div>
      <div class="confidence-text">Confidence: 0%</div>
    </div>
    <div class="slop-explain"></div>
  `;
  
  return scoreDiv;
}

// Animate the bar and the numeric counters from 0 to targets
function animateScoreDisplay(scoreDisplay) {
  const container = scoreDisplay.querySelector('.score-container');
  if (!container) return;
  const targetScore = Math.max(0, Math.min(100, Number(container.dataset.score) || 0));
  const targetConf = Math.max(0, Math.min(100, Number(container.dataset.confidence) || 0));
  const fill = container.querySelector('.score-fill');
  const scoreValueEl = container.querySelector('.score-value');
  const confEl = container.querySelector('.confidence-text');

  const duration = 900; // ms
  const start = performance.now();

  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = easeInOutQuad(t);
    const s = Math.round(eased * targetScore);
    const c = Math.round(eased * targetConf);
    if (fill) fill.style.width = `${s}%`;
    if (scoreValueEl) scoreValueEl.textContent = `${s}%`;
    if (confEl) confEl.textContent = `Confidence: ${c}%`;
    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

function highlightSuspiciousText(tweetElement, suspiciousWords) {
  if (!suspiciousWords || suspiciousWords.length === 0) return;
  
  const textNodes = [];
  const walker = document.createTreeWalker(
    tweetElement,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let node;
  while (node = walker.nextNode()) {
    if (node.parentElement.closest('.slop-detect-btn, .slop-score-display, .slop-highlight, .slop-line-highlight, .slop-human-highlight, .slop-human-line-highlight')) continue;
    textNodes.push(node);
  }
  
  const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalizeForPattern = (s) => escapeForRegex(String(s).trim()).replace(/\s+/g, '\\s+');
  const allowShort = new Set(['ai','gpt']);
  const hasLetters = (s) => /[A-Za-z]/.test(s);

  // Pre-filter and prioritize candidates to avoid noisy per-letter highlighting
  const toLen = (w) => (w && w.word ? String(w.word).length : 0);
  const candidates = suspiciousWords.filter(wd => {
    const raw = wd && wd.word ? String(wd.word).trim() : '';
    if (!raw) return false;
    if (raw.length < 3 && !allowShort.has(raw.toLowerCase())) return false;
    if (!hasLetters(raw) && raw.length < 6) return false;
    return true;
  }).sort((a,b) => toLen(b) - toLen(a)).slice(0, 12);

  textNodes.forEach(textNode => {
    let content = textNode.textContent;
    let hasHighlight = false;

    candidates.forEach(wordData => {
      const raw = (wordData && wordData.word) ? String(wordData.word) : '';
      const reason = (wordData && wordData.reason) ? String(wordData.reason) : '';
      if (!raw) return;
      const trimmed = raw.trim();
      if (!hasLetters(trimmed)) return;

      // Simple case-insensitive search first
      if (content.toLowerCase().includes(raw.toLowerCase())) {
        hasHighlight = true;
        let pattern = new RegExp(`\\b${escapeForRegex(raw)}\\b`, 'gi');
        content = content.replace(pattern, `<span class="slop-highlight" data-reason="${reason}" aria-label="${reason}" title="${reason}">$&</span>`);
        return;
      }
      // Flexible whitespace-tolerant fallback (handles punctuation/spacing differences)
      const flex = new RegExp(normalizeForPattern(raw), 'gi');
      if (flex.test(content)) {
        hasHighlight = true;
        content = content.replace(flex, `<span class="slop-highlight" data-reason="${reason}" aria-label="${reason}" title="${reason}">$&</span>`);
      }
    });

    if (hasHighlight) {
      const wrapper = document.createElement('span');
      wrapper.innerHTML = content;
      textNode.parentNode.replaceChild(wrapper, textNode);
    }
  });
}

function highlightSuspiciousLines(tweetElement, suspiciousLines) {
  if (!Array.isArray(suspiciousLines) || suspiciousLines.length === 0) return;

  const textNodes = [];
  const walker = document.createTreeWalker(
    tweetElement,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  while (node = walker.nextNode()) {
    if (node.parentElement.closest('.slop-detect-btn, .slop-score-display, .slop-highlight, .slop-line-highlight')) continue;
    textNodes.push(node);
  }

  // Properly escape regex special chars
  const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalizeForPattern = (s) => escapeForRegex(String(s).trim()).replace(/\s+/g, '\\s+');

  const candidates = suspiciousLines.filter(it => (it && (it.text || it)).toString().trim().length > 3)
                                    .slice(0, 6);

  textNodes.forEach(textNode => {
    let content = textNode.textContent;
    let hasHighlight = false;

    candidates.forEach(item => {
      const text = (item && item.text) ? String(item.text).trim() : String(item).trim();
      const reason = (item && item.reason) ? String(item.reason) : 'AI pattern';
      if (!text) return;

      // Simple case-insensitive search first
      if (content.toLowerCase().includes(text.toLowerCase())) {
        hasHighlight = true;
        const regex = new RegExp(escapeForRegex(text), 'gi');
        content = content.replace(regex, `<span class="slop-line-highlight" data-reason="${reason}" aria-label="${reason}" title="${reason}">$&</span>`);
        return;
      }
      // Flexible whitespace-tolerant search
      const flex = new RegExp(normalizeForPattern(text), 'gi');
      if (flex.test(content)) {
        hasHighlight = true;
        content = content.replace(flex, `<span class="slop-line-highlight" data-reason="${reason}" aria-label="${reason}" title="${reason}">$&</span>`);
      }
    });

    if (hasHighlight) {
      const wrapper = document.createElement('span');
      wrapper.innerHTML = content;
      textNode.parentNode.replaceChild(wrapper, textNode);
    }
  });
}

function highlightHumanText(tweetElement, words) {
  if (!words || words.length === 0) return;
  const textNodes = [];
  const walker = document.createTreeWalker(tweetElement, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while (node = walker.nextNode()) {
    if (node.parentElement.closest('.slop-detect-btn, .slop-score-display, .slop-highlight, .slop-human-highlight')) continue;
    textNodes.push(node);
  }
  const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalizeForPattern = (s) => escapeForRegex(String(s).trim()).replace(/\s+/g, '\\s+');
  const allowShort = new Set(['ai','gpt']);

  // Pre-filter and prioritize
  const toLen = (w) => (w && w.word ? String(w.word).length : 0);
  const candidates = words.filter(wd => {
    const raw = wd && wd.word ? String(wd.word).trim() : '';
    if (!raw) return false;
    if (raw.length < 3 && !allowShort.has(raw.toLowerCase())) return false;
    if (!hasLetters(raw) && raw.length < 6) return false;
    return true;
  }).sort((a,b) => toLen(b) - toLen(a)).slice(0, 12);

  textNodes.forEach(textNode => {
    let content = textNode.textContent;
    let hasHighlight = false;
    candidates.forEach(wd => {
      const raw = wd && wd.word ? String(wd.word) : '';
      const reason = wd && wd.reason ? String(wd.reason) : 'human evidence';
      if (!raw) return;
      const trimmed = raw.trim();
      if (!hasLetters(trimmed)) return;

      // 1) Exact word-boundary match (case-insensitive)
      let pattern = new RegExp(`\\b${escapeForRegex(raw)}\\b`, 'gi');
      if (pattern.test(content)) {
        hasHighlight = true;
        content = content.replace(pattern, `<span class="slop-human-highlight" data-reason="${reason}" aria-label="${reason}">$&</span>`);
        return;
      }
      const flex = new RegExp(normalizeForPattern(raw), 'gi');
      if (flex.test(content)) {
        hasHighlight = true;
        content = content.replace(flex, `<span class="slop-human-highlight" data-reason="${reason}" aria-label="${reason}">$&</span>`);
      }
    });
    if (hasHighlight) {
      const wrapper = document.createElement('span');
      wrapper.innerHTML = content;
      textNode.parentNode.replaceChild(wrapper, textNode);
    }
  });
}

function highlightHumanLines(tweetElement, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return;
  const textNodes = [];
  const walker = document.createTreeWalker(tweetElement, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while (node = walker.nextNode()) {
    if (node.parentElement.closest('.slop-detect-btn, .slop-score-display, .slop-highlight, .slop-line-highlight, .slop-human-highlight, .slop-human-line-highlight')) continue;
    textNodes.push(node);
  }
  const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalizeForPattern = (s) => escapeForRegex(String(s).trim()).replace(/\s+/g, '\\s+');

  textNodes.forEach(textNode => {
    let content = textNode.textContent;
    let hasHighlight = false;
    lines.forEach(item => {
      const text = item && item.text ? String(item.text).trim() : '';
      const reason = item && item.reason ? String(item.reason) : 'human evidence';
      if (!text) return;
      let pattern = new RegExp(escapeForRegex(text), 'g');
      if (pattern.test(content)) {
        hasHighlight = true;
        content = content.replace(pattern, `<span class="slop-human-line-highlight" data-reason="${reason}" aria-label="${reason}">$&</span>`);
      } else {
        const flex = new RegExp(normalizeForPattern(text), 'gi');
        if (flex.test(content)) {
          hasHighlight = true;
          content = content.replace(flex, `<span class="slop-human-line-highlight" data-reason="${reason}" aria-label="${reason}">$&</span>`);
        }
      }
    });
    if (hasHighlight) {
      const wrapper = document.createElement('span');
      wrapper.innerHTML = content;
      textNode.parentNode.replaceChild(wrapper, textNode);
    }
  });
}

function getTweetText(article) {
  const tweetTextElement = article.querySelector('[data-testid="tweetText"]');
  return tweetTextElement ? tweetTextElement.textContent : '';
}

function getTweetId(article) {
  const timeElement = article.querySelector('time');
  if (timeElement && timeElement.parentElement) {
    const href = timeElement.parentElement.getAttribute('href');
    if (href) {
      const match = href.match(/\/status\/(\d+)/);
      return match ? match[1] : null;
    }
  }
  return null;
}

async function analyzeWithGemini(tweetText) {
  const response = await safeSendMessage({ action: 'analyzeTweet', text: tweetText });
  return response;
}

function addDetectionButton(article) {
  const tweetId = getTweetId(article);
  if (!tweetId) return;
  
  if (article.querySelector('.slop-detect-btn')) return;
  
  let actionBar = article.querySelector('[role="group"]');
  // Fallbacks: Twitter frequently changes DOM; try common toolbars near like/reply/bookmark
  if (!actionBar) {
    const likeBtn = article.querySelector('[data-testid="like"]');
    if (likeBtn) {
      // climb up to the toolbar container
      actionBar = likeBtn.closest('[role="group"]') || likeBtn.closest('div[aria-label]') || likeBtn.parentElement;
    }
  }
  if (!actionBar) {
    const replyBtn = article.querySelector('[data-testid="reply"]');
    if (replyBtn) {
      actionBar = replyBtn.closest('[role="group"]') || replyBtn.closest('div[aria-label]') || replyBtn.parentElement;
    }
  }
  if (!actionBar) return;
  
  const button = createDetectionButton();
  
  // Position button between comment and retweet buttons
  const replyBtn = actionBar.querySelector('[data-testid="reply"]');
  const retweetBtn = actionBar.querySelector('[data-testid="retweet"]');
  
  if (replyBtn && retweetBtn) {
    // Create a wrapper div to match Twitter's button structure
    const buttonWrapper = document.createElement('div');
    buttonWrapper.style.cssText = 'display: flex; align-items: center; justify-content: center;';
    buttonWrapper.appendChild(button);
    
    // Insert the wrapped button between reply and retweet
    const retweetContainer = retweetBtn.parentElement;
    retweetContainer.parentNode.insertBefore(buttonWrapper, retweetContainer);
  } else {
    // Fallback: append to action bar
    actionBar.appendChild(button);
  }
  
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (isAnalyzing) return;
    
    const tweetText = getTweetText(article);
    if (!tweetText.trim()) {
      alert('No text found to analyze');
      return;
    }
    
    if (analysisResults.has(tweetId)) {
      const result = analysisResults.get(tweetId);
      displayResults(article, result);
      return;
    }
    
    isAnalyzing = true;
    button.innerHTML = `
      <div class="loading-spinner"></div>
      <span>Analyzing...</span>
    `;
    button.disabled = true;
    
    const analysisTimeout = setTimeout(() => {
      if (isAnalyzing) {
        console.warn('SlopDetect: Analysis timed out after 30 seconds');
        isAnalyzing = false;
        button.disabled = false;
        button.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          <span>Timeout</span>
        `;
        alert('Analysis timed out. Please try again or check your internet connection.');
      }
    }, 30000); // 30 second timeout
    
    try {
      const result = await analyzeWithGemini(tweetText);
      clearTimeout(analysisTimeout);
      
      if (result.error) {
        // If API key is missing, offer to open settings
        if (result.error.toLowerCase().includes('no api key')) {
          const goToSettings = confirm('SlopDetect: No Gemini API key set. Open settings to add your API key now?');
          if (goToSettings) {
            try {
              chrome.runtime.sendMessage({ action: 'openOptions' });
            } catch (e) { /* ignore */ }
          }
        }
        // Handle extension reloads/unloads mid-session
        if (result.error.toLowerCase().includes('extension context invalidated')) {
          alert('SlopDetect was reloaded or updated. Please refresh this page and try again.');
        }
        throw new Error(result.error);
      }
      
      analysisResults.set(tweetId, result);
      // Update usage statistics only on fresh analyses
      try {
        const { slopDetectStats } = await chrome.storage.local.get(['slopDetectStats']);
        // Backward-compatible merge of possible legacy keys
        const base = {
          totalAnalyses: 0,
          aiDetected: 0,
          totalScore: 0
        };
        const legacy = slopDetectStats || {};
        const normalized = {
          totalAnalyses: Number.isFinite(legacy.totalAnalyses) ? legacy.totalAnalyses : (Number(legacy.totalAnalyzed) || 0),
          aiDetected: Number(legacy.aiDetected) || 0,
          totalScore: Number(legacy.totalScore) || 0
        };
        const stats = { ...base, ...normalized };
        stats.totalAnalyses += 1;
        if (result.aiScore >= 60) stats.aiDetected += 1;
        stats.totalScore += Number(result.aiScore) || 0;
        await chrome.storage.local.set({ slopDetectStats: stats });
      } catch (e) {
        console.warn('Failed to update stats:', e);
      }
      
      displayResults(article, result);
      
    } catch (error) {
      clearTimeout(analysisTimeout);
      console.error('Analysis error:', error);
      button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        <span>Error</span>
      `;
      alert(`Analysis failed: ${error.message}`);
    } finally {
      isAnalyzing = false;
    }
  });
  ensureButtonPosition(article);
}

function displayResults(article, result) {
  const existingScore = article.querySelector('.slop-score-display');
  if (existingScore) {
    existingScore.remove();
  }
  
  const scoreDisplay = createScoreDisplay(result.aiScore, result.confidence);
  
  const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
  if (!tweetTextEl) {
    // If the tweet text container isn't found, bail gracefully without throwing
    console.warn('SlopDetect: tweetText element not found for displayResults');
    return;
  }
  const tweetContent = (tweetTextEl.closest('div') && tweetTextEl.closest('div').parentElement) ? tweetTextEl.closest('div').parentElement : tweetTextEl.parentElement;
  if (!tweetContent) {
    console.warn('SlopDetect: tweetContent container not found for displayResults');
    return;
  }
  tweetContent.appendChild(scoreDisplay);
  try { animateScoreDisplay(scoreDisplay); } catch (e) { /* no-op */ }
  

  const explainEl = scoreDisplay.querySelector('.slop-explain');
  if (explainEl && result.explain) {
    const w = result.explain.blend?.weights || { model: 0.5, heuristic: 0.5 };
    const disagree = typeof result.explain.blend?.disagreement === 'number' ? result.explain.blend.disagreement : 0;
    const modelEvidence = result.explain.model?.evidenceCount ?? 0;
    const aiWords = (result.explain.heuristic?.aiEvidence?.words || []).slice(0, 6);
    const humanWords = (result.explain.heuristic?.humanEvidence?.words || []).slice(0, 6);
    const aiCount = (result.explain.heuristic?.aiEvidence?.words?.length || 0) + (result.explain.heuristic?.aiEvidence?.lines?.length || 0);
    const humanCount = (result.explain.heuristic?.humanEvidence?.words?.length || 0) + (result.explain.heuristic?.humanEvidence?.lines?.length || 0);
    const totalSignals = Math.max(1, aiCount + humanCount);
    const aiPct = Math.round((aiCount / totalSignals) * 100);
    const humanPct = 100 - aiPct;

    const reasonsAll = (result.explain.heuristic?.reasons || []);
   
    const topReasons = reasonsAll.slice(0, 4);
    
    const aiChips = aiWords.map(wd => `<span class="slop-chip ai">${wd.word}</span>`).join('');
    const humanChips = humanWords.map(wd => `<span class="slop-chip human">${wd.word}</span>`).join('');
    
    explainEl.innerHTML = `
      <div class="slop-row"><div>Model: ${(w.model*100).toFixed(0)}%</div><div>Heuristic: ${(w.heuristic*100).toFixed(0)}%</div></div>
      <div class="slop-row"><div>Disagreement: ${disagree.toFixed(0)}</div><div>Evidence: ${modelEvidence} items</div></div>
      <div class="slop-mini-bar">
        <div class="slop-mini-fill ai" style="width:${aiPct}%;" title="AI-leaning signals ${aiPct}%"></div>
        <div class="slop-mini-fill human" style="width:${humanPct}%;" title="Human-leaning signals ${humanPct}%"></div>
      </div>
      ${topReasons.length ? `<div class="slop-reasons">${topReasons.map(r => `<span class="slop-reason">${r.replace(/_/g,' ')}</span>`).join('')}</div>` : ''}
      ${aiChips ? `<div class="slop-chips-row">AI signals: ${aiChips}</div>` : ''}
      ${humanChips ? `<div class="slop-chips-row">Human cues: ${humanChips}</div>` : ''}
    `;
  }
  
  const aiWordsAll = [
    ...(Array.isArray(result.suspiciousWords) ? result.suspiciousWords : []),
    ...(((result.explain && result.explain.heuristic && result.explain.heuristic.aiEvidence && result.explain.heuristic.aiEvidence.words) || []).map(w => ({ word: w.word || w, reason: w.reason || 'AI evidence' })))
  ];
  const seen = new Set();
  const mergedAiWords = aiWordsAll.filter(w => {
    const key = (w && (w.word || w))?.toString().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (mergedAiWords.length > 0) {
    const tEl = article.querySelector('[data-testid="tweetText"]');
    if (tEl) highlightSuspiciousText(tEl, mergedAiWords);
  }
  const aiLinesAll = [
    ...(Array.isArray(result.suspiciousLines)
      ? result.suspiciousLines.map(it => {
          if (it && typeof it === 'object' && (it.text || it.line)) {
            return { text: it.text || it.line, reason: it.reason || 'AI pattern' };
          }
          return { text: String(it), reason: 'AI pattern' };
        })
      : []),
    ...(((result.explain && result.explain.heuristic && result.explain.heuristic.aiEvidence && result.explain.heuristic.aiEvidence.lines) || [])
        .map(l => ({ text: (l && (l.text || l.line)) ? (l.text || l.line) : String(l), reason: (l && l.reason) ? l.reason : 'AI pattern' })))
  ];
  if (aiLinesAll.length > 0) {
    const tEl2 = article.querySelector('[data-testid="tweetText"]');
    if (tEl2) highlightSuspiciousLines(tEl2, aiLinesAll);
  }
  const he = result.explain && result.explain.heuristic;
  if (he) {
    const tEl3 = article.querySelector('[data-testid="tweetText"]');
    if (tEl3) {
      if (he.humanEvidence && Array.isArray(he.humanEvidence.words) && he.humanEvidence.words.length > 0) {
        highlightHumanText(tEl3, he.humanEvidence.words);
      }
      if (he.humanEvidence && Array.isArray(he.humanEvidence.lines) && he.humanEvidence.lines.length > 0) {
        highlightHumanLines(tEl3, he.humanEvidence.lines);
      }
    }
  }

  try {
    setTimeout(() => {
      const tEl = article.querySelector('[data-testid="tweetText"]');
      if (!tEl) return;
      if (mergedAiWords.length > 0) highlightSuspiciousText(tEl, mergedAiWords);
      if (aiLinesAll.length > 0) highlightSuspiciousLines(tEl, aiLinesAll);
      if (he) {
        if (he.humanEvidence && Array.isArray(he.humanEvidence.words) && he.humanEvidence.words.length > 0) {
          highlightHumanText(tEl, he.humanEvidence.words);
        }
        if (he.humanEvidence && Array.isArray(he.humanEvidence.lines) && he.humanEvidence.lines.length > 0) {
          highlightHumanLines(tEl, he.humanEvidence.lines);
        }
      }
    }, 150);
  } catch (e) { /* ignore */ }
  
  const button = article.querySelector('.slop-detect-btn');
  if (button) {
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <span>Analyzed</span>
    `;
    button.disabled = false;
  }
}

function observeTweets() {
  const observer = new MutationObserver((mutations) => {
    let scheduleEnsure = false;
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const articles = node.querySelectorAll ? node.querySelectorAll('article[data-testid="tweet"]') : [];
          articles.forEach(addDetectionButton);
          if (node.matches && node.matches('article[data-testid="tweet"]')) {
            addDetectionButton(node);
          }
          scheduleEnsure = true;
        }
      });
      if (mutation.type === 'childList') {
        scheduleEnsure = true;
      }
    });
    if (scheduleEnsure) {
      if (ensureTimer) clearTimeout(ensureTimer);
      ensureTimer = setTimeout(ensureButtonsAndPositions, 150);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  document.querySelectorAll('article[data-testid="tweet"]').forEach(addDetectionButton);
  // Initial ensure after first pass
  ensureButtonsAndPositions();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observeTweets);
} else {
  observeTweets();
}

function ensureButtonPosition(article) {
  const actionBar = article.querySelector('[role="group"]');
  if (!actionBar) return;
  const button = article.querySelector('.slop-detect-btn');
  if (!button) return;
  const replyBtn = actionBar.querySelector('[data-testid="reply"]');
  const retweetBtn = actionBar.querySelector('[data-testid="retweet"]');
  if (replyBtn && retweetBtn) {
    const retweetContainer = retweetBtn.parentElement;
    const buttonWrapper = button.parentElement;
    if (buttonWrapper && buttonWrapper.nextSibling !== retweetContainer) {
      // Reposition the wrapper between reply and retweet
      retweetContainer.parentNode.insertBefore(buttonWrapper, retweetContainer);
    }
  }
}

function ensureButtonsAndPositions() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  articles.forEach(article => {
    if (!article.querySelector('.slop-detect-btn')) {
      addDetectionButton(article);
    } else {
      ensureButtonPosition(article);
    }
  });
}
