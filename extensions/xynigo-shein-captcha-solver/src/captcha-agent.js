'use strict';

// 解题编排：检测 → shadow DOM 取图 → 拼编号图 → 桥接识别 → 合成点击 → 等结果 → 刷新重试。
// 平台差异全部收进 bridge（扩展=background 中转；Tampermonkey=GM 直连），本文件只管 DOM 与流程。
// DOM 细节（分类阈值/行优先排序/pointer 全序列点击）承自 v0.2.0 实测实现。
(function exposeCaptchaAgent(root, factory) {
    const api = factory(root.XynigoCaptchaPuzzle);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.XynigoCaptchaAgent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCaptchaAgent(puzzle) {

    const CHALLENGE_TAG = 'nine-captcha-custom';
    const DIALOG_SELECTOR = '.si-verify-block-request-dialog'; // 组件改名/换结构时的兜底检测锚点。
    const INSTRUCTION_SELECTORS = [
        'h1', 'h2', 'h3', 'h4', '[role="heading"]',
        '[class*="title"]', '[class*="prompt"]', '[class*="tips"]', '[class*="tip"]', '[class*="desc"]',
    ].join(',');
    const REFRESH_SELECTOR = '.nine-refresh';
    const POLL_INTERVAL_MS = 2000;
    const OUTCOME_POLL_MS = 400;
    const CLICK_GAP_MIN_MS = 500;   // 相邻格子点击间隔下限，模拟人工节奏。
    const CLICK_GAP_MAX_MS = 1500;
    const REFRESH_SETTLE_MS = 2000; // 刷新验证码后等待新图渲染。
    const MAX_CELL_FETCH_FAILURES = 3; // 单轮允许拉取失败的格子图上限（URL 有过期机制）。

    function createAgent(bridge, env) {
        const cfg = env || {};
        const log = cfg.log || function () {};
        const warn = cfg.warn || function () {};
        const sleep = cfg.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        const randInt = cfg.randInt || ((min, max) => Math.floor(min + Math.random() * (max - min + 1)));
        const doc = cfg.document || document;
        const win = cfg.window || (typeof window !== 'undefined' ? window : undefined);

        let running = false;
        let timer = null;
        let observer = null;

        function searchFrames(selector) {
            const hits = [];
            const collect = (scope) => {
                try { scope.querySelectorAll(selector).forEach((element) => hits.push(element)); } catch (_error) { /* 跨域 iframe 不可访问。 */ }
            };
            collect(doc);
            try {
                for (const frame of doc.querySelectorAll('iframe')) collect(frame.contentDocument);
            } catch (_error) { /* iframe 枚举失败不影响主文档。 */ }
            return hits;
        }

        function captchaIsPresent() {
            return searchFrames(CHALLENGE_TAG).length > 0 || searchFrames(DIALOG_SELECTOR).length > 0;
        }

        function readVisibleText(element) {
            if (!element) return '';
            return String(element.innerText || element.textContent || '').trim();
        }

        // 规则文字通常在 nine-captcha-custom 外层 dialog 的 title/tip 节点，
        // 也有版本放进 open shadowRoot。收集候选后由 puzzle 纯函数筛出短规则文字。
        function extractChallengeInstruction(challengeRoot) {
            const candidates = [];
            const scopes = [];
            const dialog = challengeRoot.closest && challengeRoot.closest(DIALOG_SELECTOR);
            if (dialog) scopes.push(dialog);
            if (challengeRoot.shadowRoot) scopes.push(challengeRoot.shadowRoot);
            scopes.forEach((scope) => {
                try {
                    scope.querySelectorAll(INSTRUCTION_SELECTORS).forEach((element) => candidates.push(readVisibleText(element)));
                } catch (_error) { /* 单个选择器失效不影响整体兜底。 */ }
                candidates.push(readVisibleText(scope));
            });
            return puzzle.pickChallengeInstruction(candidates);
        }

        function extractChallenge() {
            for (const challengeRoot of searchFrames(CHALLENGE_TAG)) {
                const shadow = challengeRoot.shadowRoot;
                if (!shadow) continue;
                const imgs = Array.prototype.slice.call(shadow.querySelectorAll('img'));
                if (imgs.length < 10) continue;
                const metas = imgs.map((img) => {
                    const box = img.getBoundingClientRect();
                    return {
                        el: img,
                        src: img.currentSrc || img.src || '',
                        width: box.width || img.width || 0,
                        top: box.top,
                        left: box.left,
                    };
                });
                const classified = puzzle.classifyImages(metas);
                if (classified.ok) {
                    classified.root = challengeRoot;
                    classified.instruction = extractChallengeInstruction(challengeRoot);
                    return classified;
                }
            }
            return null;
        }

        function loadImage(src) {
            return new Promise((resolve, reject) => {
                const image = new (win ? win.Image : Image)();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('图片解码失败'));
                image.src = src;
            });
        }

        // 组装编号拼图：顶部「提示图」+ 3x3 红色编号格（1-9 行优先）；缺图画灰格容错。
        function composePuzzle(hintImage, cellImages) {
            const layout = puzzle.LAYOUT;
            const canvas = doc.createElement('canvas');
            canvas.width = layout.canvasWidth;
            canvas.height = layout.canvasHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('canvas 2d 上下文不可用');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.fillStyle = '#333333';
            ctx.font = '14px sans-serif';
            ctx.textBaseline = 'top';
            ctx.fillText(layout.hintLabelText, layout.hintLabelPos.x, layout.hintLabelPos.y);
            ctx.fillText(layout.gridLabelText, layout.gridLabelPos.x, layout.gridLabelPos.y);

            if (hintImage) ctx.drawImage(hintImage, layout.hintRect.x, layout.hintRect.y, layout.hintRect.w, layout.hintRect.h);

            cellImages.forEach((image, index) => {
                const rect = puzzle.cellRect(index + 1);
                if (image) {
                    ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
                } else {
                    ctx.fillStyle = '#dddddd';
                    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
                }
            });

            // 红色编号角标最后画，确保不被图片覆盖。
            const badge = layout.badgeSize;
            for (let index = 1; index <= 9; index += 1) {
                const rect = puzzle.cellRect(index);
                ctx.fillStyle = '#e02020';
                ctx.fillRect(rect.x, rect.y, badge, badge);
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 18px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(index), rect.x + badge / 2, rect.y + badge / 2 + 1);
                ctx.textAlign = 'start';
                ctx.textBaseline = 'alphabetic';
            }
            return canvas.toDataURL('image/jpeg', 0.9);
        }

        // 全序列 pointer+mouse 合成点击，行为对齐真实指针路径（真实环境验证过的写法）。
        function syntheticClick(element, clientX, clientY) {
            const options = {
                pointerType: 'mouse', cancelable: true, bubbles: true,
                view: win, clientX, clientY, button: 0, buttons: 1,
            };
            const Pointer = win ? win.PointerEvent : undefined;
            if (typeof Pointer === 'function') {
                for (const type of ['pointerover', 'pointerenter', 'pointermove']) {
                    element.dispatchEvent(new Pointer(type, options));
                }
                element.dispatchEvent(new Pointer('pointerdown', options));
            }
            for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
                element.dispatchEvent(new MouseEvent(type, options));
            }
            element.dispatchEvent(new MouseEvent('mousedown', options));
            if (typeof Pointer === 'function') element.dispatchEvent(new Pointer('pointerup', options));
            element.dispatchEvent(new MouseEvent('mouseup', options));
            element.dispatchEvent(new MouseEvent('click', options));
        }

        function clickElementCenter(element) {
            const box = element.getBoundingClientRect();
            syntheticClick(element, box.x + box.width / 2, box.y + box.height / 2);
        }

        async function clickMatches(cells, matches) {
            for (const n of matches) {
                const target = cells[n - 1] && cells[n - 1].el;
                if (!target) continue;
                clickElementCenter(target);
                log('点击格子', n);
                await sleep(randInt(CLICK_GAP_MIN_MS, CLICK_GAP_MAX_MS));
            }
        }

        function waitGone(challengeRoot) {
            const deadline = Date.now() + (cfg.settleTimeoutMs || 8000);
            return new Promise((resolve) => {
                const poll = setInterval(() => {
                    if (!challengeRoot.isConnected || !doc.contains(challengeRoot)) {
                        clearInterval(poll);
                        resolve(true);
                        return;
                    }
                    if (Date.now() > deadline) {
                        clearInterval(poll);
                        resolve(false);
                    }
                }, cfg.outcomePollMs || OUTCOME_POLL_MS);
            });
        }

        async function clickRefresh(challenge) {
            const shadow = challenge && challenge.root && challenge.root.shadowRoot;
            const refresh = (shadow && shadow.querySelector(REFRESH_SELECTOR)) || doc.querySelector(REFRESH_SELECTOR);
            if (!refresh) {
                warn('未找到刷新按钮，等待组件自动换图。');
                return false;
            }
            clickElementCenter(refresh);
            await sleep(REFRESH_SETTLE_MS);
            return true;
        }

        function makeRecord(puzzleId, role, meta, extra) {
            return Object.assign({
                ts: Date.now(),
                puzzleId,
                role,
                provider: (meta && meta.provider) || '?',
                model: (meta && meta.model) || '?',
                latencyMs: 0,
                answer: [],
                outcome: 'error',
                error: '',
            }, extra || {});
        }

        // 取图：URL 有过期机制，取到立即逐张拉取；单图失败占位灰格，超限放弃本轮。
        async function fetchPuzzleSources(challenge) {
            const sources = [challenge.hint].concat(challenge.cells);
            const dataUrls = [];
            let cellFailures = 0;
            for (let index = 0; index < sources.length; index += 1) {
                try {
                    dataUrls.push(await bridge.fetchImage(sources[index].src));
                } catch (_error) {
                    dataUrls.push('');
                    if (index > 0) cellFailures += 1;
                }
            }
            if (!dataUrls[0]) throw new Error('提示图拉取失败');
            if (cellFailures > MAX_CELL_FETCH_FAILURES) throw new Error(`格子图拉取失败 ${cellFailures} 张（URL 可能已过期）`);
            const hintImage = await loadImage(dataUrls[0]);
            const cellImages = [];
            for (let index = 0; index < 9; index += 1) {
                cellImages.push(dataUrls[index + 1] ? await loadImage(dataUrls[index + 1]) : null);
            }
            return composePuzzle(hintImage, cellImages);
        }

        // 单次解题会话：最多 maxRounds 轮。每轮重新提取组件并取图——刷新换图后
        // 图片 URL 与 DOM 元素都会更换，必须用新一轮的拼图与元素解题/点击。
        async function solveSession() {
            const puzzleId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);

            const config = await bridge.getConfig();
            if (!config || !config.model || !config.apiKey) {
                if (!notConfiguredLogged) {
                    warn('模型未配置（缺 model 或 API Key）：请在扩展弹窗填写 API Key 并保存。');
                    notConfiguredLogged = true;
                }
                return;
            }

            for (let round = 1; round <= (config.maxRounds || 3); round += 1) {
                const challenge = extractChallenge();
                if (!challenge) {
                    warn('检测到验证码对话框，但未能解析出提示图+9 格子结构（组件可能已改版或在不可访问的 iframe 内）。');
                    return;
                }
                log(`第 ${round}/${config.maxRounds} 轮识别…`);
                const prompt = puzzle.buildPrompt(challenge.instruction);
                if (challenge.instruction) {
                    log('页面验证规则：', challenge.instruction);
                } else {
                    log('未提取到验证规则标题，本轮使用默认“与提示图同类”规则。');
                }

                let puzzleData;
                try {
                    puzzleData = await fetchPuzzleSources(challenge);
                } catch (error) {
                    warn('取图/拼图失败：', error && error.message);
                    return;
                }

                let solved;
                try {
                    solved = await bridge.solve(puzzleData, prompt);
                } catch (error) {
                    warn('识别桥接失败：', error && error.message);
                    return;
                }

                // 影子模型只记录答案不点击，供配对比较。
                if (solved.shadow) {
                    const shadowMeta = solved.compare || {};
                    let shadowAnswer = [];
                    if (solved.shadow.ok) {
                        try { shadowAnswer = puzzle.parseModelAnswer(solved.shadow.text).matches; } catch (_error) { /* 记空 */ }
                    }
                    await bridge.appendLogs([makeRecord(puzzleId, 'shadow', shadowMeta, {
                        latencyMs: solved.shadow.latencyMs || 0,
                        answer: shadowAnswer,
                        outcome: solved.shadow.ok ? 'pass' : 'error',
                        error: solved.shadow.error || '',
                    })]);
                }

                const primaryMeta = solved.config || {};
                if (!solved.primary || !solved.primary.ok) {
                    const primaryError = (solved.primary && solved.primary.error) || '识别调用失败';
                    await bridge.appendLogs([makeRecord(puzzleId, 'primary', primaryMeta, {
                        latencyMs: solved.primary ? solved.primary.latencyMs : 0,
                        outcome: 'error',
                        error: primaryError,
                    })]);
                    warn('识别调用失败：', primaryError);
                    if (/401/.test(primaryError)) {
                        warn('API Key 无效或欠费，请在扩展弹窗更新后重试。');
                        return;
                    }
                    return;
                }

                let matches;
                if (Array.isArray(solved.primary.answer)) {
                    matches = solved.primary.answer;
                } else {
                    try {
                        matches = puzzle.parseModelAnswer(solved.primary.text).matches;
                    } catch (_error) {
                        matches = [];
                    }
                }
                log('识别结果：', matches);

                if (!matches.length) {
                    await bridge.appendLogs([makeRecord(puzzleId, 'primary', primaryMeta, {
                        latencyMs: solved.primary.latencyMs,
                        outcome: 'fail',
                        error: '模型未返回有效编号：' + String(solved.primary.text || '').slice(0, 120),
                    })]);
                    if (!(await clickRefresh(challenge))) return;
                    continue;
                }

                await clickMatches(challenge.cells, matches);
                const passed = await waitGone(challenge.root);

                await bridge.appendLogs([makeRecord(puzzleId, 'primary', primaryMeta, {
                    latencyMs: solved.primary.latencyMs,
                    answer: matches,
                    outcome: passed ? 'pass' : 'fail',
                    error: passed ? '' : '点击后验证码未消失',
                })]);

                if (passed) {
                    log('验证码已通过，继续监听。');
                    if (config.collectSamples) {
                        try {
                            await bridge.appendSample({
                                id: puzzleId,
                                ts: Date.now(),
                                image: puzzleData,
                                instruction: challenge.instruction || '',
                                prompt,
                                groundTruth: matches,
                            });
                        } catch (_error) { /* 样本落盘失败不影响过验。 */ }
                    }
                    return;
                }
                warn(`第 ${round} 轮未过验，尝试刷新换图。`);
                if (round < config.maxRounds && !(await clickRefresh(challenge))) return;
            }
            warn('已达到最大重试次数，停止自动处理，请人工完成本次验证码。');
        }

        // 静默跳过是 2026-08-28 "验证码出现插件没反应"事故的根因之一：检测到验证码、
        // 自动解题关闭、配置读取失败三种状态都必须留下日志（每个验证码回合只提示一次）。
        let presenceLogged = false;
        let autoSolveOffLogged = false;
        let notConfiguredLogged = false;

        async function maybeSolve() {
            if (running) return;
            if (!captchaIsPresent()) {
                presenceLogged = false;
                autoSolveOffLogged = false;
                notConfiguredLogged = false;
                return;
            }
            if (!presenceLogged) {
                log('检测到验证码，开始处理。');
                presenceLogged = true;
            }
            let config;
            try {
                config = await bridge.getConfig();
            } catch (error) {
                warn('读取配置失败：', error && error.message);
                return;
            }
            if (config && config.autoSolve === false) {
                if (!autoSolveOffLogged) {
                    warn('「自动解题」已关闭：本次留人工处理，可在扩展弹窗勾选开启。');
                    autoSolveOffLogged = true;
                }
                return;
            }
            running = true;
            try {
                await solveSession();
            } finally {
                running = false;
            }
        }

        function start() {
            if (timer || observer) return;
            timer = setInterval(() => { maybeSolve().catch((error) => warn('轮询异常：', error && error.message)); }, POLL_INTERVAL_MS);
            if (typeof MutationObserver === 'function') {
                observer = new MutationObserver(() => { maybeSolve().catch(() => {}); });
                observer.observe(doc.documentElement, { childList: true, subtree: true });
            }
            log('已启动监听（nine-captcha-custom），验证码出现时自动处理。');
        }

        function stop() {
            if (timer) { clearInterval(timer); timer = null; }
            if (observer) { observer.disconnect(); observer = null; }
        }

        return { start, stop, maybeSolve };
    }

    return { createAgent };
});
