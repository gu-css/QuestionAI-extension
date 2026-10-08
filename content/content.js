/**
 * QuestionAI - Content Script
 * Scans webpage headlines, sends to API proxy, and applies visual badges with unsupervised typologies.
 * Authoritative source: ORIGINAL_REQUEST.md AC R3 & PROJECT.md
 */

(function () {
  'use strict';
  console.log('[QuestionAI] Content script loaded on ' + window.location.href);

  // Target headline selectors across general sites and major Brazilian news portals
  const HEADLINE_SELECTORS = [
    'h1', 'h2', 'h3', 'h4',
    '[role="heading"]',
    'article a',
    '.headline', '.title',
    '.feed-post-title',      // G1
    '.headlineSub__title',   // UOL
    '.c-headline__title'     // Folha de S.Paulo
  ].join(', ');


  let globalTooltip = null;

  function getGlobalTooltip() {
    if (!globalTooltip) {
      globalTooltip = document.getElementById('questionai-global-tooltip');
    }
    if (!globalTooltip) {
      globalTooltip = document.createElement('div');
      globalTooltip.id = 'questionai-global-tooltip';
      globalTooltip.style.cssText = `
        all: initial !important;
        position: fixed !important;
        z-index: 2147483647 !important;
        background-color: #1a202c !important;
        color: #f7fafc !important;
        padding: 8px 12px !important;
        border-radius: 6px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        font-size: 12px !important;
        line-height: 1.5 !important;
        box-shadow: 0 4px 10px rgba(0,0,0,0.3) !important;
        pointer-events: none !important;
        display: none !important;
        flex-direction: column !important;
        min-width: 180px !important;
        width: max-content !important;
      `;
      document.body.appendChild(globalTooltip);
    }
    return globalTooltip;
  }

  document.addEventListener('mouseover', (e) => {
    const targetEl = e.target.closest('.clickbait-detected');
    if (targetEl) {
      const tooltip = getGlobalTooltip();
      const baitType = targetEl.dataset.baitType;
      const prob = targetEl.dataset.prob;
      const conf = targetEl.dataset.conf;
      
      tooltip.innerHTML = `
        <strong style="all: initial !important; display: block !important; color: #D500F5 !important; font-weight: 700 !important; margin-bottom: 6px !important; font-family: inherit !important; font-size: 13px !important;">🚨 Alerta de Clickbait</strong>
        <span style="all: initial !important; display: block !important; color: #e2e8f0 !important; font-family: inherit !important; font-size: 12px !important; line-height: 1.4 !important;">
          A IA tem <strong style="all: initial !important; color: #fff !important; font-weight: 600 !important; font-family: inherit !important; font-size: 12px !important;">${prob}% de certeza</strong> que o título usa a tática de <strong style="all: initial !important; color: #fff !important; font-weight: 600 !important; font-family: inherit !important; font-size: 12px !important;">${escapeHtml(baitType)}</strong>.
        </span>
      `;
      
      tooltip.style.setProperty('display', 'flex', 'important');
      
      // Compute position
      const rect = targetEl.getBoundingClientRect();
      let top = rect.top - tooltip.offsetHeight - 8;
      if (top < 0) {
        top = rect.bottom + 8; // flip to bottom if no space at top
      }
      
      tooltip.style.setProperty('top', top + 'px', 'important');
      tooltip.style.setProperty('left', rect.left + 'px', 'important');
    }
  });

  document.addEventListener('mouseout', (e) => {
    const targetEl = e.target.closest('.clickbait-detected');
    if (targetEl) {
      const tooltip = getGlobalTooltip();
      tooltip.style.setProperty('display', 'none', 'important');
    }
  });

  window.addEventListener('scroll', () => {
    if (globalTooltip) {
      globalTooltip.style.setProperty('display', 'none', 'important');
    }
  }, {passive: true});

  let isInjectingBadges = false;
  let debounceTimer = null;

  // Safe HTML string escaping to prevent XSS
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Clean and extract text from element
  function extractCleanText(el) {
    return (el.textContent || '').trim().replace(/\s+/g, ' ');
  }

  // Validate candidate element against noise filtering rules
  function isValidCandidate(el) {
    // Idempotency checks
    if (
      el.dataset.clickbaitScanned === 'true' ||
      el.classList.contains('clickbait-detected')
    ) {
      return false;
    }

    // Exclude boilerplate parents
    if (el.closest('nav, header, footer, aside, button, form, select, textarea, svg')) {
      return false;
    }

    // Avoid double-matching <a> when inside an existing heading
    if (
      el.tagName.toLowerCase() === 'a' &&
      el.closest('h1, h2, h3, h4, [role="heading"]')
    ) {
      return false;
    }

    // If el contains inner heading elements, ignore the outer container
    if (
      el.querySelector('h1, h2, h3, h4, [role="heading"], .feed-post-title, .headlineSub__title, .c-headline__title')
    ) {
      return false;
    }

    const text = extractCleanText(el);
    const words = text.split(/\s+/).filter(Boolean);

    // Minimum text length > 18 chars and word count > 3 words
    if (text.length <= 18 || words.length <= 3) {
      return false;
    }

    return true;
  }

  // --- Image blur helpers ------------------------------------------------
  function isMeaningfulImage(img) {
    if (!img || img.tagName.toLowerCase() !== 'img') return false;
    const src = img.currentSrc || img.src || '';
    if (/data:image\/(svg|gif)/i.test(src)) return false;
    if (/\.(svg|gif)(\?|#|$)/i.test(src)) return false;
    if (img.width && img.width < 60) return false;
    if (img.height && img.height < 40) return false;
    if (/\b(avatar|icon|logo|emoji|badge|spinner|qr)\b/i.test(img.className || '')) return false;
    return true;
  }

  function imageArea(img) {
    const r = img.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r.width * r.height;
    const nw = img.naturalWidth || img.width || 0;
    const nh = img.naturalHeight || img.height || 0;
    return nw * nh;
  }

  function findMainImage(el) {
    // Case 1: the headline link itself wraps the thumbnail (<a><img>...title</a>)
    const selfImgs = Array.from(el.querySelectorAll('img')).filter(isMeaningfulImage);
    if (selfImgs.length === 1) {
      return { img: selfImgs[0], container: el };
    }

    // Case 2: walk up to the nearest card containing a meaningful image
    let node = el.parentElement;
    for (let depth = 0; depth < 4 && node && node !== document.body; depth++) {
      const imgs = Array.from(node.querySelectorAll('img')).filter(isMeaningfulImage);
      if (imgs.length === 1) {
        return { img: imgs[0], container: node };
      }
      if (imgs.length > 1 && imgs.length <= 4) {
        let best = imgs[0];
        let bestArea = imageArea(best);
        for (const img of imgs) {
          const a = imageArea(img);
          if (a > bestArea) { bestArea = a; best = img; }
        }
        return { img: best, container: node };
      }
      if (imgs.length > 4) return null; // container too broad (list/page)
      node = node.parentElement;
    }
    return null;
  }

  // Visual badge injection
  function injectBadge(el, data) {
    if (el.classList.contains('clickbait-detected')) {
      return;
    }

    el.classList.add('clickbait-detected');

    const baitType = data.bait_type || 'Sensacionalismo';
    const probPercent = Math.round((data.probability || 0) * 100);
    const confPercent = Math.round((data.confidence || 0) * 100);

    el.dataset.baitType = baitType;
    el.dataset.prob = probPercent;
    el.dataset.conf = confPercent;

    // Blur the main associated image so it reveals together with the headline
    try {
      const found = findMainImage(el);
      if (found && found.img) {
        found.img.classList.add('clickbait-image-blurred');
        if (found.container) {
          found.container.classList.add('clickbait-card');
        }
      }
    } catch (e) {
      // Image detection failure must not break headline injection
    }
  }

  // Scan and process DOM headlines
  function scanHeadlines() {
    console.log('[QuestionAI] Scanning headlines...');
    if (isInjectingBadges) return;

    let elements = [];
    try {
      elements = Array.from(document.querySelectorAll(HEADLINE_SELECTORS));
    } catch (e) {
      return;
    }

    const candidates = [];
    const candidateElements = [];

    for (const el of elements) {
      if (isValidCandidate(el)) {
        candidates.push(extractCleanText(el));
        candidateElements.push(el);
        el.dataset.clickbaitScanned = 'true';
      }
    }

    if (candidates.length === 0) return;

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        // Step 1: Check cache for instant loading
        chrome.runtime.sendMessage(
          { action: 'checkCache', headlines: candidates },
          (cacheResponse) => {
            if (chrome.runtime.lastError) return;
            if (!cacheResponse || !cacheResponse.success) return;

            // Apply cached badges immediately
            if (cacheResponse.cachedResults && cacheResponse.cachedResults.length > 0) {
               isInjectingBadges = true;
               requestAnimationFrame(() => {
                 try {
                   cacheResponse.cachedResults.forEach(data => {
                      if (data && data.is_clickbait && data.headline) {
                         const idx = candidates.indexOf(data.headline);
                         if (idx !== -1 && candidateElements[idx]) {
                           injectBadge(candidateElements[idx], data);
                         }
                      }
                   });
                 } finally {
                   isInjectingBadges = false;
                 }
               });
            }

            // Step 2: Query API for missing items
            const missing = cacheResponse.missingHeadlines || [];
            if (missing.length === 0) return;

            const missingElements = missing.map(hl => candidateElements[candidates.indexOf(hl)]);

            chrome.runtime.sendMessage(
              {
                action: 'predictBatch',
                headlines: missing
              },
              (response) => {
                if (chrome.runtime.lastError) return;
                if (!response || !response.success || !response.results) return;

                isInjectingBadges = true;
                requestAnimationFrame(() => {
                  try {
                    response.results.forEach((data, idx) => {
                      if (data && data.is_clickbait && missingElements[idx]) {
                        injectBadge(missingElements[idx], data);
                      }
                    });
                  } finally {
                    isInjectingBadges = false;
                  }
                });
              }
            );
          }
        );
      } catch (e) {
        // Extension reloaded while page is open
        return;
      }
    }
  }

  // Debounced scan scheduler (300ms)
  let isExtensionActive = false;

  function scheduleScan() {
    if (!isExtensionActive) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanHeadlines, 300);
  }

  // Initialize MutationObserver for SPAs and infinite scroll feeds
  if (typeof MutationObserver !== 'undefined' && document.body) {
    const observer = new MutationObserver((mutations) => {
      if (!isExtensionActive || isInjectingBadges) return;
      let hasRelevantMutation = false;

      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              hasRelevantMutation = true;
              break;
            }
          }
        }
        if (hasRelevantMutation) break;
      }

      if (hasRelevantMutation) {
        scheduleScan();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function removeClickbaitEffects() {
    document.querySelectorAll('.clickbait-detected').forEach((e) => {
      e.classList.remove('clickbait-detected');
      delete e.dataset.baitType;
      delete e.dataset.prob;
      delete e.dataset.conf;
    });
    document.querySelectorAll('.clickbait-image-blurred').forEach((e) => e.classList.remove('clickbait-image-blurred'));
    document.querySelectorAll('.clickbait-card').forEach((e) => e.classList.remove('clickbait-card'));
    document.querySelectorAll('[data-clickbait-scanned]').forEach((e) => delete e.dataset.clickbaitScanned);
  }

  function updateExtensionState(data) {
    const disabledSites = data.disabledSites || [];
    const isDisabledSite = disabledSites.includes(window.location.hostname);
    const isGloballyDisabled = data.enabled === false;

    if (isGloballyDisabled || isDisabledSite) {
      isExtensionActive = false;
      removeClickbaitEffects();
    } else {
      const wasInactive = !isExtensionActive;
      isExtensionActive = true;
      if (wasInactive) {
        scheduleScan();
      }
    }
  }

  function initializeApp() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['disabledSites', 'enabled'], (data) => {
        updateExtensionState(data);
        
        // Initial scan on load
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', scheduleScan);
        } else {
          scheduleScan();
        }
      });

      // Listen for storage changes (toggle on/off)
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local') {
          if (changes.enabled || changes.disabledSites) {
            chrome.storage.local.get(['disabledSites', 'enabled'], updateExtensionState);
          }
        }
      });
    } else {
      isExtensionActive = true;
      scheduleScan();
    }
  }

  initializeApp();

  // Intercept clicks on clickbait links
  function showWarningModal(href, archetype, linkEl) {
    if (document.getElementById('questionai-warning-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'questionai-warning-modal';
    modal.className = 'questionai-overlay';
    
    modal.innerHTML = `
      <div class="questionai-modal-content">
        <div class="questionai-icon" style="color: #8200D6; font-size: 54px;">⛔</div>
        <h2>Alerta de Clickbait!</h2>
        <p>Você está prestes a abrir uma notícia manipulativa classificada como <strong>${escapeHtml(archetype)}</strong>.</p>
        
        <div class="questionai-harms">
          <h3>Por que isso é prejudicial?</h3>
          <ul>
            <li><strong>Manipulação Emocional:</strong> Brinca com sua ansiedade e curiosidade usando gatilhos falsos.</li>
            <li><strong>Perda de Tempo:</strong> A manchete omite o fato principal apenas para forçar seu clique.</li>
            <li><strong>Desinformação:</strong> Muitas vezes, o conteúdo não entrega a promessa chocante do título.</li>
          </ul>
        </div>

        <div class="questionai-actions">
          <button id="questionai-btn-cancel" class="btn-cancel">Não, me tire daqui</button>
          <button id="questionai-btn-continue" class="btn-continue">Sim, quero ver mesmo assim</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('questionai-btn-cancel').addEventListener('click', () => {
      modal.remove();
    });

    document.getElementById('questionai-btn-continue').addEventListener('click', () => {
      modal.remove();
      linkEl.dataset.clickbaitBypassed = 'true';
      
      // Simulate normal navigation
      if (linkEl.target === '_blank') {
        window.open(href, '_blank');
      } else {
        window.location.href = href;
      }
    });
  }

  document.addEventListener('click', function(e) {
    const link = e.target.closest('a');
    if (!link) return;

    // Is the link itself a clickbait or inside a clickbait wrapper?
    const clickbaitEl = e.target.closest('.clickbait-detected');
    if (!clickbaitEl) {
      // Sometimes the badge is next to the link, so check if any parent contains the badge but is not the link itself
      // Actually, injectBadge adds 'clickbait-detected' to the heading or link itself.
      // If the link is inside an h2 that has clickbait-detected, it will be caught.
      // If the link IS the clickbait-detected, it will be caught.
      return;
    }

    if (link.dataset.clickbaitBypassed === 'true') return;

    e.preventDefault();
    e.stopPropagation();

    let archetype = clickbaitEl.dataset.baitType || "Sensacionalismo Geral";

    showWarningModal(link.href, archetype, link);
  }, true); // Use capture phase to intercept before site's own click handlers

})();
