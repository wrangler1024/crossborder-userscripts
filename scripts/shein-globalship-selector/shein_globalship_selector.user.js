// ==UserScript==
// @name         Xynigo SHEIN GlobalShip Selector
// @namespace    https://github.com/wrangler1024/crossborder-userscripts
// @version      0.1.0
// @description  Adds a GlobalShip filter to SHEIN US search results and excludes Local or QuickShip items.
// @author       Samforo
// @homepageURL  https://github.com/wrangler1024/crossborder-userscripts/tree/main/scripts/shein-globalship-selector
// @supportURL   https://github.com/wrangler1024/crossborder-userscripts/issues
// @match        https://us.shein.com/pdsearch/*
// @icon         https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/assets/xynigo-mascot.png
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-globalship-selector/shein_globalship_selector.user.js
// @updateURL    https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-globalship-selector/shein_globalship_selector.user.js
// ==/UserScript==

(function expose(root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    root.XynigoSheinGlobalShipSelector = api;

    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
        api.boot();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createGlobalShipSelector() {
    'use strict';

    const BUTTON_ID = 'xynigo-shein-globalship-selector';
    const STYLE_ID = `${BUTTON_ID}-style`;
    const HIDDEN_ATTR = 'data-xynigo-globalship-hidden';
    const LISTENER_ATTR = 'data-xynigo-globalship-listener';
    const SESSION_KEY = 'xynigo-shein-globalship-active-v1';
    const PRODUCT_LINK_SELECTOR = 'a[href*="-p-"][href*=".html"]';
    const CONTROL_SELECTOR = 'button, [role="button"], [role="switch"], [role="checkbox"]';

    function text(value) {
        return value === undefined || value === null ? '' : String(value);
    }

    function toUrl(value, base = undefined) {
        try {
            return new URL(value, base);
        } catch (_error) {
            return null;
        }
    }

    function normalizeLabel(value) {
        return text(value).trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function isSearchResultsUrl(url) {
        const parsed = toUrl(url);
        return Boolean(parsed
            && parsed.hostname.toLowerCase() === 'us.shein.com'
            && /^\/pdsearch\//i.test(parsed.pathname));
    }

    function extractProductId(url, base = 'https://us.shein.com/') {
        const match = toUrl(url, base)?.pathname.match(/-p-(\d+)\.html(?:\/)?$/i);
        return match ? match[1] : '';
    }

    function isLocalFulfillmentLabel(value) {
        const normalized = normalizeLabel(value);
        return normalized === 'local' || normalized === 'quickship';
    }

    function hasLocalFulfillmentLabel(values) {
        return Array.from(values || []).some((value) => isLocalFulfillmentLabel(value));
    }

    function isQuickShipTaggedUrl(url) {
        const parsed = toUrl(url);
        if (!parsed) return false;
        return parsed.searchParams.getAll('tag_ids').some((value) => (
            value.toLowerCase().split(',').map((tag) => tag.trim()).includes('quickship')
        ));
    }

    function productIdsWithin(root) {
        const ids = new Set();
        const links = [];
        if (root?.matches?.(PRODUCT_LINK_SELECTOR)) links.push(root);
        root?.querySelectorAll?.(PRODUCT_LINK_SELECTOR).forEach((link) => links.push(link));
        links.forEach((link) => {
            const goodsId = extractProductId(link.href || link.getAttribute?.('href'));
            if (goodsId) ids.add(goodsId);
        });
        return ids;
    }

    function hasAddToCartControl(root) {
        return Array.from(root?.querySelectorAll?.('button, [role="button"]') || []).some((control) => (
            normalizeLabel(control.textContent) === 'add to cart'
        ));
    }

    function findProductCard(link) {
        const goodsId = extractProductId(link?.href || link?.getAttribute?.('href'));
        if (!goodsId) return null;
        let current = link;
        let fallback = null;

        for (let depth = 0; current?.parentElement && depth < 12; depth += 1) {
            current = current.parentElement;
            const ids = productIdsWithin(current);
            if (ids.size > 1) break;
            if (ids.size !== 1 || !ids.has(goodsId)) continue;

            const sameProductLinks = Array.from(current.querySelectorAll(PRODUCT_LINK_SELECTOR))
                .filter((candidate) => extractProductId(candidate.href || candidate.getAttribute?.('href')) === goodsId);
            if (hasAddToCartControl(current)) return current;
            if (sameProductLinks.length >= 2) fallback = current;
        }
        return fallback;
    }

    function collectProductCards(root = document) {
        const cards = new Set();
        root.querySelectorAll(PRODUCT_LINK_SELECTOR).forEach((link) => {
            const card = findProductCard(link);
            if (card) cards.add(card);
        });
        return Array.from(cards);
    }

    function elementHasLocalFulfillmentLabel(element) {
        const ownText = Array.from(element?.childNodes || [])
            .filter((node) => node.nodeType === 3)
            .map((node) => node.nodeValue)
            .join(' ');
        if (isLocalFulfillmentLabel(ownText)) return true;
        return ['aria-label', 'title', 'alt'].some((name) => (
            isLocalFulfillmentLabel(element?.getAttribute?.(name))
        ));
    }

    function cardHasLocalFulfillmentBadge(card) {
        if (elementHasLocalFulfillmentLabel(card)) return true;
        return Array.from(card?.querySelectorAll?.('*') || []).some((element) => (
            elementHasLocalFulfillmentLabel(element)
        ));
    }

    function findNativeQuickShipControl(root = document) {
        return Array.from(root.querySelectorAll(CONTROL_SELECTOR)).find((control) => (
            control.id !== BUTTON_ID
            && !control.closest?.(`#${BUTTON_ID}`)
            && normalizeLabel(control.textContent) === 'quickship'
        )) || null;
    }

    function nativeQuickShipIsActive(control, url = location.href) {
        if (isQuickShipTaggedUrl(url)) return true;
        return ['aria-pressed', 'aria-checked'].some((name) => control?.getAttribute?.(name) === 'true')
            || control?.classList?.contains('active')
            || control?.classList?.contains('is-active');
    }

    function boot() {
        if (window.__xynigoSheinGlobalShipSelectorBooted) return;
        window.__xynigoSheinGlobalShipSelectorBooted = true;

        const state = {
            active: readSession(),
            button: null,
            timer: 0,
            lastUrl: location.href,
            quickShipTogglePendingUntil: 0,
            suppressNativeQuickShipClick: false,
        };

        function readSession() {
            try {
                return window.sessionStorage.getItem(SESSION_KEY) === '1';
            } catch (_error) {
                return false;
            }
        }

        function saveSession() {
            try {
                window.sessionStorage.setItem(SESSION_KEY, state.active ? '1' : '0');
            } catch (_error) {
                // Restricted sessions keep the in-memory state only.
            }
        }

        function restoreCards() {
            document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((card) => card.removeAttribute(HIDDEN_ATTR));
        }

        function updateButton({ total = 0, hidden = 0, waiting = false } = {}) {
            const button = state.button;
            if (!button?.isConnected) return;
            button.setAttribute('aria-pressed', state.active ? 'true' : 'false');
            if (waiting) {
                button.title = 'Switching off QuickShip before showing GlobalShip items';
            } else if (state.active) {
                button.title = `GlobalShip active: showing ${Math.max(0, total - hidden)}/${total} loaded items`;
            } else {
                button.title = 'Show international shipping (fully managed) items';
            }
        }

        function setActive(active) {
            state.active = Boolean(active);
            state.quickShipTogglePendingUntil = 0;
            saveSession();
            if (!state.active) restoreCards();
            updateButton();
            schedule(0);
        }

        function attachNativeQuickShipListener(control) {
            if (!control || control.getAttribute(LISTENER_ATTR) === '1') return;
            control.setAttribute(LISTENER_ATTR, '1');
            control.addEventListener('click', () => {
                if (!state.active || state.suppressNativeQuickShipClick) return;
                setActive(false);
            }, true);
        }

        function turnOffNativeQuickShip(control) {
            if (!control || Date.now() < state.quickShipTogglePendingUntil) return;
            state.quickShipTogglePendingUntil = Date.now() + 4000;
            state.suppressNativeQuickShipClick = true;
            control.click();
            state.suppressNativeQuickShipClick = false;
        }

        function applyFilter() {
            if (!isSearchResultsUrl(location.href)) return;
            const nativeQuickShip = findNativeQuickShipControl();
            attachNativeQuickShipListener(nativeQuickShip);

            if (!state.active) {
                restoreCards();
                updateButton();
                return;
            }

            if (nativeQuickShipIsActive(nativeQuickShip)) {
                restoreCards();
                updateButton({ waiting: true });
                turnOffNativeQuickShip(nativeQuickShip);
                schedule(900);
                return;
            }

            state.quickShipTogglePendingUntil = 0;
            const cards = collectProductCards();
            let hidden = 0;
            cards.forEach((card) => {
                if (cardHasLocalFulfillmentBadge(card)) {
                    card.setAttribute(HIDDEN_ATTR, 'true');
                    hidden += 1;
                } else {
                    card.removeAttribute(HIDDEN_ATTR);
                }
            });
            updateButton({ total: cards.length, hidden });
        }

        function mountStyle() {
            if (document.getElementById(STYLE_ID)) return;
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = `
                [${HIDDEN_ATTR}="true"] { display:none !important; }
                #${BUTTON_ID} {
                    box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; gap:6px;
                    min-height:32px; margin:0; padding:0 12px; border:1px solid #e5e5e5; border-radius:2px;
                    background:#f7f7f7; color:#666; cursor:pointer;
                    font:500 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
                    list-style:none; white-space:nowrap; vertical-align:middle; user-select:none;
                }
                #${BUTTON_ID}:hover { border-color:#999; color:#222; }
                #${BUTTON_ID}[aria-pressed="true"] { border-color:#198754; background:#eef8f1; color:#14733a; }
                #${BUTTON_ID} .xynigo-globalship-icon { color:#198754; font-size:15px; line-height:1; transform:rotate(-8deg); }
            `;
            (document.head || document.documentElement).appendChild(style);
        }

        function mountButton() {
            if (!isSearchResultsUrl(location.href)) return;
            mountStyle();
            const nativeQuickShip = findNativeQuickShipControl();
            attachNativeQuickShipListener(nativeQuickShip);
            if (!nativeQuickShip) return;

            let button = document.getElementById(BUTTON_ID);
            if (!button) {
                let insertionAnchor = nativeQuickShip;
                while (insertionAnchor.parentElement
                    && normalizeLabel(insertionAnchor.parentElement.textContent) === 'quickship'
                    && insertionAnchor.parentElement.children.length === 1) {
                    insertionAnchor = insertionAnchor.parentElement;
                }

                const nativeTagName = nativeQuickShip.tagName.toLowerCase();
                const selectorTagName = nativeTagName === 'li' ? 'li' : 'button';
                button = document.createElement(selectorTagName);
                button.id = BUTTON_ID;
                if (selectorTagName === 'button') button.type = 'button';
                button.className = text(nativeQuickShip.className);
                button.setAttribute('role', nativeQuickShip.getAttribute('role') || 'button');
                button.tabIndex = 0;
                button.setAttribute('aria-label', 'GlobalShip international shipping selector');
                const icon = document.createElement('span');
                icon.className = 'xynigo-globalship-icon';
                icon.setAttribute('aria-hidden', 'true');
                icon.textContent = '✈';
                const label = document.createElement('span');
                label.textContent = 'GlobalShip';
                button.append(icon, label);
                insertionAnchor.parentElement?.insertBefore(button, insertionAnchor.nextSibling);
                button.addEventListener('click', () => setActive(!state.active));
                button.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setActive(!state.active);
                });
            }
            state.button = button;
            updateButton();
        }

        function unmount() {
            document.getElementById(BUTTON_ID)?.remove();
            document.getElementById(STYLE_ID)?.remove();
            restoreCards();
            state.button = null;
            if (state.timer) window.clearTimeout(state.timer);
            state.timer = 0;
            state.quickShipTogglePendingUntil = 0;
        }

        function schedule(delay = 120) {
            if (state.timer) window.clearTimeout(state.timer);
            state.timer = window.setTimeout(() => {
                state.timer = 0;
                if (!isSearchResultsUrl(location.href)) return;
                mountButton();
                applyFilter();
            }, delay);
        }

        new MutationObserver(() => {
            if (isSearchResultsUrl(location.href)) schedule();
        }).observe(document.documentElement, { subtree: true, childList: true });

        window.setInterval(() => {
            if (location.href === state.lastUrl) return;
            state.lastUrl = location.href;
            if (isSearchResultsUrl(location.href)) {
                mountButton();
                schedule(0);
            } else {
                unmount();
            }
        }, 800);

        mountButton();
        schedule(0);
    }

    return {
        boot,
        normalizeLabel,
        isSearchResultsUrl,
        extractProductId,
        isLocalFulfillmentLabel,
        hasLocalFulfillmentLabel,
        isQuickShipTaggedUrl,
        productIdsWithin,
        findProductCard,
        collectProductCards,
        elementHasLocalFulfillmentLabel,
        cardHasLocalFulfillmentBadge,
        findNativeQuickShipControl,
        nativeQuickShipIsActive,
    };
});
