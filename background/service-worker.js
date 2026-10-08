/**
 * QuestionAI - Background Service Worker (Manifest V3)
 * Acts as an asynchronous network proxy to bypass page CSP and Mixed Content restrictions.
 * Authoritative source: ORIGINAL_REQUEST.md AC R3 & PROJECT.md
 */

const DEFAULT_CONFIG = {
  apiUrl: "https://clickbait-api.onrender.com", // Base URL to FastAPI
  enabled: true,
  timeoutMs: 5000,
  model: "kmeans" // unsupervised categorizer: "kmeans" | "hdbscan"
};

// 1. Extension lifecycle initialization
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const current = await chrome.storage.local.get(null);
    const initial = {};

    if (current.apiUrl === undefined || current.apiUrl.includes("hf.space") || current.apiUrl.includes("sua-api")) {
      initial.apiUrl = DEFAULT_CONFIG.apiUrl;
    }
    if (current.enabled === undefined) initial.enabled = DEFAULT_CONFIG.enabled;
    if (current.stats === undefined) initial.stats = { totalScanned: 0, clickbaitDetected: 0 };
    if (current.model === undefined) initial.model = DEFAULT_CONFIG.model;

    if (Object.keys(initial).length > 0) {
      await chrome.storage.local.set(initial);
    }
  } catch (err) {
    console.error("Initialization error:", err);
  }
});

// 2. URL normalizers
function normalizePredictUrl(rawUrl, endpoint) {
  let url = (rawUrl || DEFAULT_CONFIG.apiUrl).trim();
  url = url.replace(/\/+$/, "");
  return url + endpoint;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, {
    ...options,
    signal: controller.signal
  });
  clearTimeout(id);
  return response;
}

// 4. API communication helpers
async function querySingleHeadline(headline, apiUrl, timeoutMs, model) {
  const url = normalizePredictUrl(apiUrl, "/predict?headline=" + encodeURIComponent(headline) + "&model=" + encodeURIComponent(model || "kmeans"));
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, timeoutMs);
  
  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }
  return await response.json();
}

async function queryBatchHeadlines(headlines, apiUrl, timeoutMs, model) {
  const url = normalizePredictUrl(apiUrl, "/predict_batch");
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ headlines: headlines, model: model || "kmeans" })
  }, timeoutMs);
  
  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }
  const data = await response.json();
  const results = data.results || [];
  return {
    total: results.length,
    results: results
  };
}

async function checkApiHealth(rawUrl) {
  const url = normalizePredictUrl(rawUrl, "/health");
  try {
    const response = await fetchWithTimeout(url, { method: "GET" }, 3000);
    if (response.ok) {
      return { online: true, data: await response.json() };
    }
    return { online: false, status: response.status };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

// 5. Message routing (must synchronously return true for async sendResponse)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request.action || request.type;

  (async () => {
    try {
      const settings = await chrome.storage.local.get(["apiUrl", "enabled", "stats", "threshold", "headlineCache", "model"]);
      const isEnabled = settings.enabled !== false;
      const apiUrl = request.apiUrl || settings.apiUrl || DEFAULT_CONFIG.apiUrl;
      const threshold = settings.threshold !== undefined ? settings.threshold : 75;
      const timeoutMs = DEFAULT_CONFIG.timeoutMs;
      const model = request.model || settings.model || "kmeans";
      
      let cache = settings.headlineCache || {};

      // getConfig
      if (action === "getConfig" || action === "GET_CONFIG") {
        sendResponse({
          success: true,
          config: {
            apiUrl: settings.apiUrl || DEFAULT_CONFIG.apiUrl,
            enabled: isEnabled,
            stats: settings.stats || { totalScanned: 0, clickbaitDetected: 0 },
            threshold: threshold,
            model: model,
            cachedItems: Object.keys(cache).length
          }
        });
        return;
      }

      // healthCheck
      if (action === "healthCheck" || action === "HEALTH_CHECK" || action === "checkHealth") {
        const health = await checkApiHealth(apiUrl);
        sendResponse({ success: true, health: health });
        return;
      }

      // clearCache
      if (action === "clearCache" || action === "CLEAR_CACHE") {
        await chrome.storage.local.set({ headlineCache: {} });
        sendResponse({ success: true });
        return;
      }

      // Disabled check
      if (!isEnabled) {
        sendResponse({ success: false, disabled: true, reason: "QuestionAI is disabled." });
        return;
      }

      // checkCache (for instant loading of cached items)
      if (action === "checkCache") {
        const headlines = request.headlines || [];
        const cachedResults = [];
        const missingHeadlines = [];
        const currentTimestamp = Date.now();
        
        headlines.forEach(hl => {
          if (cache[hl]) {
            cache[hl].lastUsed = currentTimestamp;
            let res = Object.assign({}, cache[hl].result);
            if (res && res.probability !== undefined) {
               res.is_clickbait = (res.probability * 100) >= threshold;
            }
            cachedResults.push(res);
          } else {
            missingHeadlines.push(hl);
          }
        });
        
        // save lastUsed updates if we had hits, but it's optional for read-only speed. We will just save it.
        if (cachedResults.length > 0) {
           await chrome.storage.local.set({ headlineCache: cache });
        }

        sendResponse({ success: true, cachedResults, missingHeadlines });
        return;
      }

      // predictBatch
      if (action === "predictBatch" || action === "PREDICT_BATCH") {
        const headlines = request.headlines || [];
        if (!headlines.length) {
          sendResponse({ success: true, results: [], total: 0, data: [] });
          return;
        }

        const missingHeadlines = [];
        const finalResults = [];
        const currentTimestamp = Date.now();

        // Check cache
        headlines.forEach(hl => {
          if (cache[hl]) {
            cache[hl].lastUsed = currentTimestamp;
            finalResults.push(cache[hl].result);
          } else {
            missingHeadlines.push(hl);
          }
        });

        let newDetectedCount = 0;

        // Query missing
        if (missingHeadlines.length > 0) {
          const data = await queryBatchHeadlines(missingHeadlines, apiUrl, timeoutMs, model);
          const results = data.results || [];

          results.forEach(r => {
             if (r && r.probability !== undefined) {
                 r.is_clickbait = (r.probability * 100) >= threshold;
                 if (r.is_clickbait) newDetectedCount++;
             }
             
             // Add to cache
             if (r && r.headline) {
               cache[r.headline] = {
                 result: r,
                 lastUsed: currentTimestamp
               };
             }
             finalResults.push(r);
          });

          // Trim cache to 500 items (LRU)
          const cacheKeys = Object.keys(cache);
          if (cacheKeys.length > 500) {
            cacheKeys.sort((a, b) => cache[b].lastUsed - cache[a].lastUsed); // Descending
            const trimmedCache = {};
            for (let i = 0; i < 500; i++) {
              trimmedCache[cacheKeys[i]] = cache[cacheKeys[i]];
            }
            cache = trimmedCache;
          }

          // Save cache
          await chrome.storage.local.set({ headlineCache: cache });
        }

        // Apply threshold override for cached results (they might have been cached with a different threshold originally, but wait - the result object contains original probability. So let's re-evaluate)
        finalResults.forEach(r => {
            if (r && r.probability !== undefined) {
                r.is_clickbait = (r.probability * 100) >= threshold;
            }
        });

        // Update stats in storage (only counting newly scanned missing headlines as 'totalScanned'? No, usually totalScanned is cumulative of all items ever seen. Let's just add missingHeadlines.length to totalScanned).
        const currentStats = settings.stats || { totalScanned: 0, clickbaitDetected: 0 };
        await chrome.storage.local.set({
          stats: {
            totalScanned: currentStats.totalScanned + missingHeadlines.length,
            clickbaitDetected: currentStats.clickbaitDetected + newDetectedCount
          }
        });

        // Re-sort finalResults to match original request order if necessary? Not strictly required by most content scripts, but returning in original order is better.
        const orderMap = new Map();
        finalResults.forEach(r => { if (r && r.headline) orderMap.set(r.headline, r); });
        const orderedResults = headlines.map(hl => orderMap.get(hl)).filter(Boolean);

        sendResponse({
          success: true,
          results: orderedResults,
          data: orderedResults,
          total: orderedResults.length
        });
        return;
      }

      // predictClickbait (single headline)
      if (action === "predictClickbait" || action === "PREDICT") {
        const text = request.headline || request.text;
        if (!text) {
          sendResponse({ success: false, error: "Headline text is required." });
          return;
        }

        const currentTimestamp = Date.now();
        let result;
        let fromCache = false;

        if (cache[text]) {
          cache[text].lastUsed = currentTimestamp;
          result = cache[text].result;
          fromCache = true;
          // Apply threshold override
          if (result && result.probability !== undefined) {
             result.is_clickbait = (result.probability * 100) >= threshold;
          }
        } else {
          result = await querySingleHeadline(text, apiUrl, timeoutMs, model);
          if (result && result.probability !== undefined) {
             result.is_clickbait = (result.probability * 100) >= threshold;
          }
          
          if (result && result.headline) {
             cache[result.headline] = {
               result: result,
               lastUsed: currentTimestamp
             };
          } else if (result) {
             // Fallback if API doesn't return headline field
             result.headline = text;
             cache[text] = { result: result, lastUsed: currentTimestamp };
          }

          // Trim cache
          const cacheKeys = Object.keys(cache);
          if (cacheKeys.length > 500) {
            cacheKeys.sort((a, b) => cache[b].lastUsed - cache[a].lastUsed);
            const trimmedCache = {};
            for (let i = 0; i < 500; i++) {
              trimmedCache[cacheKeys[i]] = cache[cacheKeys[i]];
            }
            cache = trimmedCache;
          }
          await chrome.storage.local.set({ headlineCache: cache });
        }

        const currentStats = settings.stats || { totalScanned: 0, clickbaitDetected: 0 };
        
        if (!fromCache) {
          await chrome.storage.local.set({
            stats: {
              totalScanned: currentStats.totalScanned + 1,
              clickbaitDetected: currentStats.clickbaitDetected + (result && result.is_clickbait ? 1 : 0)
            }
          });
        }

        sendResponse({ success: true, data: result });
        return;
      }

      sendResponse({ success: false, error: `Unknown action: ${action}` });
    } catch (err) {
      sendResponse({
        success: false,
        error: err.message,
        offline: true
      });
    }
  })();

  return true; // Synchronous return true keeps asynchronous sendResponse channel open
});
