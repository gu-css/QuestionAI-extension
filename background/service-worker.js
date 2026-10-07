/**
 * QuestionAI - Background Service Worker (Manifest V3)
 * Acts as an asynchronous network proxy to bypass page CSP and Mixed Content restrictions.
 * Authoritative source: ORIGINAL_REQUEST.md AC R3 & PROJECT.md
 */

const DEFAULT_CONFIG = {
  apiUrl: "http://localhost:8000", // Base URL to FastAPI
  enabled: true,
  timeoutMs: 5000
};

// 1. Extension lifecycle initialization
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const current = await chrome.storage.local.get(null);
    const initial = {};

    if (current.apiUrl === undefined) initial.apiUrl = DEFAULT_CONFIG.apiUrl;
    if (current.enabled === undefined) initial.enabled = DEFAULT_CONFIG.enabled;
    if (current.stats === undefined) initial.stats = { totalScanned: 0, clickbaitDetected: 0 };

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
async function querySingleHeadline(headline, apiUrl, timeoutMs) {
  const url = normalizePredictUrl(apiUrl, "/predict?headline=" + encodeURIComponent(headline));
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, timeoutMs);
  
  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }
  return await response.json();
}

async function queryBatchHeadlines(headlines, apiUrl, timeoutMs) {
  const url = normalizePredictUrl(apiUrl, "/predict_batch");
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ headlines: headlines })
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
      const settings = await chrome.storage.local.get(["apiUrl", "enabled", "stats"]);
      const isEnabled = settings.enabled !== false;
      const apiUrl = request.apiUrl || settings.apiUrl || DEFAULT_CONFIG.apiUrl;
      const timeoutMs = DEFAULT_CONFIG.timeoutMs;

      // getConfig
      if (action === "getConfig" || action === "GET_CONFIG") {
        sendResponse({
          success: true,
          config: {
            apiUrl: settings.apiUrl || DEFAULT_CONFIG.apiUrl,
            enabled: isEnabled,
            stats: settings.stats || { totalScanned: 0, clickbaitDetected: 0 }
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

      // Disabled check
      if (!isEnabled) {
        sendResponse({ success: false, disabled: true, reason: "QuestionAI is disabled." });
        return;
      }

      // predictBatch
      if (action === "predictBatch" || action === "PREDICT_BATCH") {
        const headlines = request.headlines || [];
        if (!headlines.length) {
          sendResponse({ success: true, results: [], total: 0, data: [] });
          return;
        }

        const data = await queryBatchHeadlines(headlines, apiUrl, timeoutMs);
        const results = data.results || [];

        // Update stats in storage
        const detectedCount = results.filter((r) => r && r.is_clickbait).length;
        const currentStats = settings.stats || { totalScanned: 0, clickbaitDetected: 0 };
        await chrome.storage.local.set({
          stats: {
            totalScanned: currentStats.totalScanned + headlines.length,
            clickbaitDetected: currentStats.clickbaitDetected + detectedCount
          }
        });

        sendResponse({
          success: true,
          results: results,
          data: results,
          total: results.length
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

        const result = await querySingleHeadline(text, apiUrl, timeoutMs);

        if (result && result.is_clickbait) {
          const currentStats = settings.stats || { totalScanned: 0, clickbaitDetected: 0 };
          await chrome.storage.local.set({
            stats: {
              totalScanned: currentStats.totalScanned + 1,
              clickbaitDetected: currentStats.clickbaitDetected + 1
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
