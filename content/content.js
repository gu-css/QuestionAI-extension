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
    badge.innerHTML = `⚠️ Clickbait: <span class="bait-type">${escapeHtml(baitType)}</span><span class="clickbait-tooltip"><span class="tooltip-title">🚨 Alerta de Clickbait</span><span class="tooltip-row">Categoria: ${escapeHtml(baitType)}</span><span class="tooltip-row">Probabilidade: ${probPercent}%</span><span class="tooltip-row">Confiança: ${confPercent}%</span></span>`;

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
})();
