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
    const badge = e.target.closest('.clickbait-badge');
    if (badge) {
      const tooltip = getGlobalTooltip();
      
      const baitType = badge.dataset.baitType;
      const prob = badge.dataset.prob;
      const conf = badge.dataset.conf;
      
      tooltip.innerHTML = `
        <strong style="all: initial !important; display: block !important; color: #D500F5 !important; font-weight: 700 !important; margin-bottom: 6px !important; font-family: inherit !important; font-size: 13px !important;">🚨 Alerta de Clickbait</strong>
        <span style="all: initial !important; display: block !important; color: #e2e8f0 !important; font-family: inherit !important; font-size: 12px !important; line-height: 1.4 !important;">
          A IA tem <strong style="all: initial !important; color: #fff !important; font-weight: 600 !important; font-family: inherit !important; font-size: 12px !important;">${prob}% de certeza</strong> que o título usa a tática de <strong style="all: initial !important; color: #fff !important; font-weight: 600 !important; font-family: inherit !important; font-size: 12px !important;">${escapeHtml(baitType)}</strong>.
        </span>
      `;
      
      tooltip.style.setProperty('display', 'flex', 'important');
      
      // Compute position
      const rect = badge.getBoundingClientRect();
      let top = rect.top - tooltip.offsetHeight - 8;
      if (top < 0) {
        top = rect.bottom + 8; // flip to bottom if no space at top
      }
      
      tooltip.style.setProperty('top', top + 'px', 'important');
      tooltip.style.setProperty('left', rect.left + 'px', 'important');
    }
  });

  document.addEventListener('mouseout', (e) => {
    const badge = e.target.closest('.clickbait-badge');
    if (badge) {
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

  // Clean and extract text from element without badge text
  function extractCleanText(el) {
    const clone = el.cloneNode(true);
    const badges = clone.querySelectorAll('.clickbait-badge, .clickbait-tooltip');
    badges.forEach((b) => b.remove());
    return (clone.textContent || '').trim().replace(/\s+/g, ' ');
  }

  // Validate candidate element against noise filtering rules
  function isValidCandidate(el) {
    // Idempotency checks
    if (
      el.dataset.clickbaitScanned === 'true' ||
      el.classList.contains('clickbait-detected') ||
      el.querySelector('.clickbait-badge')
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

  // Visual badge injection
  function injectBadge(el, data) {
    if (el.classList.contains('clickbait-detected') || el.querySelector('.clickbait-badge')) {
      return;
    }

    el.classList.add('clickbait-detected');

    const baitType = data.bait_type || 'Sensacionalismo';
    const probPercent = Math.round((data.probability || 0) * 100);
    const confPercent = Math.round((data.confidence || 0) * 100);

    const badge = document.createElement('span');
    badge.className = 'clickbait-badge';
    badge.setAttribute('role', 'status');

    // Visual text structure matching contract: "⚠️ Clickbait: <span class="bait-type">{bait_type}</span>"
    badge.dataset.baitType = baitType;
    badge.dataset.prob = probPercent;
    badge.dataset.conf = confPercent;
    badge.innerHTML = `⚠️ Clickbait: <span class="bait-type">${escapeHtml(baitType)}</span>`;

    el.appendChild(badge);
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
      candidates.forEach((headline, idx) => {
        chrome.runtime.sendMessage(
          {
            action: 'predictClickbait',
            headline: headline
          },
          (response) => {
            if (!response || !response.success || !response.data) return;

            if (response.data.is_clickbait && candidateElements[idx]) {
              isInjectingBadges = true;
              requestAnimationFrame(() => {
                try {
                  injectBadge(candidateElements[idx], response.data);
                } finally {
                  isInjectingBadges = false;
                }
              });
            }
          }
        );
      });
    }
  }

  // Debounced scan scheduler (300ms)
  function scheduleScan() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanHeadlines, 300);
  }

  // Initialize MutationObserver for SPAs and infinite scroll feeds
  if (typeof MutationObserver !== 'undefined' && document.body) {
    const observer = new MutationObserver((mutations) => {
      if (isInjectingBadges) return;
      let hasRelevantMutation = false;

      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                !node.classList?.contains('clickbait-badge') &&
                !node.classList?.contains('clickbait-tooltip')
              ) {
                hasRelevantMutation = true;
                break;
              }
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

  // Initial scan on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleScan);
  } else {
    scheduleScan();
  }

  // Listen for storage changes (toggle on/off)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.enabled) {
        if (changes.enabled.newValue === false) {
          document.querySelectorAll('.clickbait-badge').forEach((b) => b.remove());
          document.querySelectorAll('.clickbait-detected').forEach((e) => e.classList.remove('clickbait-detected'));
          document.querySelectorAll('[data-clickbait-scanned]').forEach((e) => delete e.dataset.clickbaitScanned);
        } else {
          scheduleScan();
        }
      }
    });
  }

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

    let archetype = "Sensacionalismo Geral";
    const badge = clickbaitEl.querySelector('.clickbait-badge');
    if (badge) {
      const typeEl = badge.querySelector('.bait-type');
      if (typeEl && typeEl.innerText) {
        archetype = typeEl.innerText;
      }
    }

    showWarningModal(link.href, archetype, link);
  }, true); // Use capture phase to intercept before site's own click handlers

})();
