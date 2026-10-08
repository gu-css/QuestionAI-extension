/**
 * Clickbait Shield - Popup Script
 * Manages extension state, API endpoint selection, statistics display, and connectivity testing.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const toggleEnabled = document.getElementById("toggle-enabled");
  const inputUrl = document.getElementById("api-url");
  const btnSave = document.getElementById("btn-save");
  const btnTest = document.getElementById("btn-test");
  const btnPresetLocal = document.getElementById("preset-local");
  const btnPresetHf = document.getElementById("preset-hf");
  const statScanned = document.getElementById("stat-scanned");
  const statDetected = document.getElementById("stat-detected");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");

  // Load current configuration from storage
  let settings = { apiUrl: "https://clickbait-api.onrender.com", enabled: true, stats: { totalScanned: 0, clickbaitDetected: 0 } };
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const stored = await chrome.storage.local.get(["apiUrl", "enabled", "stats"]);
    
    // Auto-migrate old URLs (Hugging Face or sua-api)
    if (stored.apiUrl && (stored.apiUrl.includes("hf.space") || stored.apiUrl.includes("sua-api"))) {
      stored.apiUrl = "https://clickbait-api.onrender.com";
      await chrome.storage.local.set({ apiUrl: stored.apiUrl });
    }
    
    settings = { ...settings, ...stored };
  }

  const isEnabled = settings.enabled !== false;
  const currentUrl = settings.apiUrl || "https://clickbait-api.onrender.com";
  const stats = settings.stats || { totalScanned: 0, clickbaitDetected: 0 };

  toggleEnabled.checked = isEnabled;
  inputUrl.value = currentUrl;
  statScanned.textContent = stats.totalScanned || 0;
  statDetected.textContent = stats.clickbaitDetected || 0;

  function updateStatus(online, message) {
    statusDot.className = "status-dot " + (online ? "online" : "offline");
    statusText.textContent = message;
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

  // Preset Buttons
  btnPresetLocal.addEventListener("click", () => {
    inputUrl.value = "http://localhost:8000";
  });

  btnPresetHf.addEventListener("click", () => {
    inputUrl.value = "https://clickbait-api.onrender.com";
  });

  // Toggle activation
  toggleEnabled.addEventListener("change", async () => {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ enabled: toggleEnabled.checked });
    }
  });

  // Save Settings
  btnSave.addEventListener("click", async () => {
    const newUrl = inputUrl.value.trim() || "http://localhost:8000";
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ apiUrl: newUrl });
    }
    updateStatus(true, "Configuração salva com sucesso!");
    setTimeout(() => checkHealth(newUrl), 800);
  });

  // Test API Connectivity
  btnTest.addEventListener("click", () => {
    checkHealth(inputUrl.value.trim());
  });

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
      if (areaName === "local" && changes.stats) {
        const newStats = changes.stats.newValue;
        if (newStats) {
          statScanned.textContent = newStats.totalScanned || 0;
          statDetected.textContent = newStats.clickbaitDetected || 0;
        }
      }
    });
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('btn-settings-toggle');
  const configSec = document.getElementById('config-section');
  if(toggleBtn && configSec) {
    toggleBtn.addEventListener('click', () => {
      if (configSec.style.display === 'none') {
        configSec.style.display = 'block';
        toggleBtn.textContent = '❌ Fechar Config';
      } else {
        configSec.style.display = 'none';
        toggleBtn.textContent = '⚙️ Config';
      }
    });
  }
});
