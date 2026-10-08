/**
 * Clickbait Shield - Popup Script
 * Manages extension state, API endpoint selection, statistics display, and connectivity testing.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const toggleEnabled = document.getElementById("toggle-enabled");
  const inputUrl = document.getElementById("api-url");
  const inputThreshold = document.getElementById("threshold-slider");
  const thresholdVal = document.getElementById("threshold-val");
  const btnSave = document.getElementById("btn-save");
  const btnTest = document.getElementById("btn-test");
  const btnPresetLocal = document.getElementById("preset-local");
  const btnPresetHf = document.getElementById("preset-hf");
  const statScanned = document.getElementById("stat-scanned");
  const statDetected = document.getElementById("stat-detected");
  const btnClearCache = document.getElementById("btn-clear-cache");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const selectModel = document.getElementById("model-select");

  // Load current configuration from storage
  let settings = { apiUrl: "https://clickbait-api.onrender.com", enabled: true, threshold: 75, model: "kmeans", stats: { totalScanned: 0, clickbaitDetected: 0 }, headlineCache: {} };
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const stored = await chrome.storage.local.get(["apiUrl", "enabled", "stats", "threshold", "headlineCache", "model"]);
    
    // Auto-migrate old URLs (Hugging Face or sua-api)
    if (stored.apiUrl && (stored.apiUrl.includes("hf.space") || stored.apiUrl.includes("sua-api"))) {
      stored.apiUrl = "https://clickbait-api.onrender.com";
      await chrome.storage.local.set({ apiUrl: stored.apiUrl });
    }
    
    settings = { ...settings, ...stored };
  }

  const isEnabled = settings.enabled !== false;
  const currentUrl = settings.apiUrl || "https://clickbait-api.onrender.com";
  const currentThreshold = settings.threshold !== undefined ? settings.threshold : 75;
  const stats = settings.stats || { totalScanned: 0, clickbaitDetected: 0 };

  toggleEnabled.checked = isEnabled;
  inputUrl.value = currentUrl;
  if (selectModel) selectModel.value = settings.model || "kmeans";
  
  if (inputThreshold && thresholdVal) {
    inputThreshold.value = currentThreshold;
    thresholdVal.textContent = currentThreshold + "%";
    
    inputThreshold.addEventListener("input", (e) => {
      thresholdVal.textContent = e.target.value + "%";
    });
  }

  function updateStatsUI(currentStats) {
    if (statScanned) statScanned.textContent = currentStats.totalScanned || 0;
    if (statDetected) statDetected.textContent = currentStats.clickbaitDetected || 0;
  }

  updateStatsUI(stats);

  function updateStatus(online, message) {
    if (statusDot) statusDot.className = "status-dot " + (online ? "online" : "offline");
    if (statusText) statusText.textContent = message;
  }

  function checkHealth(url) {
    updateStatus(false, "Testando conexão com a API...");
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "healthCheck", apiUrl: url }, (resp) => {
        if (resp && resp.success && resp.health && resp.health.online) {
          updateStatus(true, "API Conectada e Operacional ✅");
        } else {
          updateStatus(false, "API Inacessível ou Offline ❌");
        }
      });
    } else {
      updateStatus(true, "Ambiente Simulado");
    }
  }

  // Clear Cache Button
  if (btnClearCache) {
    btnClearCache.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "clearCache" }, (resp) => {
          if (resp && resp.success) {
            updateStatsUI(stats);
            updateStatus(true, "Cache limpo com sucesso!");
          }
        });
      }
    });
  }

  // Preset Buttons
  if (btnPresetLocal) {
    btnPresetLocal.addEventListener("click", () => {
      inputUrl.value = "http://localhost:8000";
    });
  }

  if (btnPresetHf) {
    btnPresetHf.addEventListener("click", () => {
      inputUrl.value = "https://clickbait-api.onrender.com";
    });
  }

  // Toggle activation
  if (toggleEnabled) {
    toggleEnabled.addEventListener("change", async () => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ enabled: toggleEnabled.checked });
      }
    });
  }

  // Save Settings
  if (btnSave) {
    btnSave.addEventListener("click", async () => {
      const newUrl = inputUrl.value.trim() || "http://localhost:8000";
      const newThreshold = parseInt(inputThreshold.value, 10);
      
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ 
          apiUrl: newUrl,
          threshold: newThreshold,
          model: selectModel ? selectModel.value : "kmeans"
        });
      }
      updateStatus(true, "Configuração salva com sucesso!");
      setTimeout(() => checkHealth(newUrl), 800);
    });
  }

  // Test API Connectivity
  if (btnTest) {
    btnTest.addEventListener("click", () => {
      checkHealth(inputUrl.value.trim());
    });
  }

  // Initial check
  checkHealth(currentUrl);

  // --- Whitelist / Blacklist (Current Site) ---
  const btnToggleSite = document.getElementById("btn-toggle-site");
  if (btnToggleSite && typeof chrome !== "undefined" && chrome.tabs) {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs || !tabs.length || !tabs[0].url) return;
      try {
        const urlObj = new URL(tabs[0].url);
        const hostname = urlObj.hostname;
        if (!hostname || hostname.startsWith('chrome-extension')) {
          btnToggleSite.style.display = 'none';
          return;
        }

        const data = await chrome.storage.local.get("disabledSites");
        let disabledSites = data.disabledSites || [];
        
        if (disabledSites.includes(hostname)) {
          btnToggleSite.textContent = `Ativar em: ${hostname}`;
          btnToggleSite.classList.add("btn-primary");
          btnToggleSite.classList.remove("btn-secondary");
        } else {
          btnToggleSite.textContent = `Desativar em: ${hostname}`;
          btnToggleSite.classList.add("btn-secondary");
          btnToggleSite.classList.remove("btn-primary");
        }

        btnToggleSite.addEventListener("click", async () => {
          const freshData = await chrome.storage.local.get("disabledSites");
          let currentList = freshData.disabledSites || [];
          
          if (currentList.includes(hostname)) {
            // Remove from disabled
            currentList = currentList.filter(h => h !== hostname);
            btnToggleSite.textContent = `Desativar em: ${hostname}`;
            btnToggleSite.classList.replace("btn-primary", "btn-secondary");
          } else {
            // Add to disabled
            currentList.push(hostname);
            btnToggleSite.textContent = `Ativar em: ${hostname}`;
            btnToggleSite.classList.replace("btn-secondary", "btn-primary");
          }
          await chrome.storage.local.set({ disabledSites: currentList });
        });
      } catch (e) {
        // Invalid URL
        btnToggleSite.style.display = 'none';
      }
    });
  }
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local") {
        if (changes.stats) {
          const newStats = changes.stats.newValue;
          if (newStats) {
            updateStatsUI(newStats);
          }
        }
      }
    });
  }

  const toggleBtn = document.getElementById('btn-settings-toggle');
  const configSec = document.getElementById('config-section');
  if(toggleBtn && configSec) {
    toggleBtn.addEventListener('click', () => {
      if (configSec.style.display === 'none') {
        configSec.style.display = 'block';
        toggleBtn.textContent = '❌ Fechar Config';
      } else {
        configSec.style.display = 'none';
        toggleBtn.textContent = 'Configurações';
      }
    });
  }
});
