// ==UserScript==
// @name         学习通自动刷课脚本 V3 稳定版
// @namespace    local.codex.xuexitong
// @version      3.8.1
// @description  自动播放、自动切换小节内任务点与下一节，并在页面结构异常时安全停止
// @author       Codex
// @match        *://mooc1.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mooc2-ans/mycourse/studentstudy*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* global $, jQuery */
(function () {
    const APP_KEY = '__xuexitongPlayerV3';
    const BOOT_TIMER_KEY = '__xuexitongPlayerV3BootTimer';

    const previousApp = window[APP_KEY];
    if (previousApp && typeof previousApp.destroy === 'function') {
        previousApp.destroy();
    }
    if (window[BOOT_TIMER_KEY]) {
        clearInterval(window[BOOT_TIMER_KEY]);
        window[BOOT_TIMER_KEY] = null;
    }

    if (typeof window.jQuery === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://code.jquery.com/jquery-3.6.0.min.js';
        script.type = 'text/javascript';
        script.onload = function () {
            console.log("jQuery loaded.");
            waitForCoursePage();
        };
        document.head.appendChild(script);
    } else {
        waitForCoursePage();
    }

    function waitForCoursePage() {
        let attempts = 0;
        const maxAttempts = 20;
        window[BOOT_TIMER_KEY] = setInterval(() => {
            if ($('#coursetree').length > 0) {
                clearInterval(window[BOOT_TIMER_KEY]);
                window[BOOT_TIMER_KEY] = null;
                initializePlayer();
                return;
            }
            attempts++;
            if (attempts >= maxAttempts) {
                clearInterval(window[BOOT_TIMER_KEY]);
                window[BOOT_TIMER_KEY] = null;
                console.error('%c脚本启动超时：未检测到课程目录（#coursetree）。请确认当前处于课程播放页。', 'color:#F44336;font-weight:bold');
            }
        }, 1000);
    }

    function initializePlayer() {
        const app = {
            configs: {
                playbackRate: 1,
                autoplay: true,
                retryInterval: 2000,
                maxRetries: 10,
                videoCheckInterval: 1000,
                guardNoProgressMs: 7000,
                guardResumeCooldownMs: 1500,
                autoAdvanceNoVideo: false,
            },
            _videoEl: null,
            _treeContainerEl: null,
            _isPlaying: false,
            _currentRetryCount: 0,
            _checkInterval: null,
            _eventVideoEl: null,
            _boundVideoHandlers: null,
            _nextUnitPending: false,
            _chapterAdvanceTimes: 0,
            _switchPending: false,
            _switchRetries: 0,
            _endedTabId: null,
            _programmaticClick: false,
            _lastVideoEl: null,
            _switchSkipCount: 0,
            _blacklistedContainer: -1,
            _cellData: {
                cells: 0,
                nCells: 0,
                currentCellIndex: 0,
                currentNCellIndex: 0,
                currentVideoTitle: "",
            },
            get cellData() {
                return this._cellData;
            },
            run() {
                console.log("%c=== 学习通自动刷课脚本 V3 优化版启动 ===", "color:#4CAF50;font-size:16px;font-weight:bold");
                this._nextUnitPending = false;
                this._chapterAdvanceTimes = 0;
                this._endedTabId = null;
                this._switchPending = false;
                this._switchRetries = 0;
                this._switchSkipCount = 0;
                this._blacklistedContainer = -1;
                this._getTreeContainer();
                this._initCellData();
                this._videoEl = null;
                this._getVideoEl();
                this._clearCheckInterval();
                this._bindStepNavigation();
                this.play();
            },
            nextUnit() {
                if (this._nextUnitPending) {
                    console.warn('%c已有小节切换正在进行，忽略重复请求', 'color:#FF9800');
                    return;
                }
                this._nextUnitPending = true;
                this._clearCheckInterval();
                console.log("%c=== 准备切换到下一小节 ===", "color:#2196F3;font-size:14px");

                if (this._advanceTaskpoint()) {
                    return;
                }

                try {
                    const el = this._getTreeContainer();
                    const cells = el.children("ul").children("li");
                    const nCells = $(cells.get(this._cellData.currentCellIndex)).find('.posCatalog_select:not(.firstLayer)');

                    if (nCells.length > this._cellData.currentNCellIndex + 1) {
                        const nextNIndex = this._cellData.currentNCellIndex + 1;
                        console.log(`%c切换到同章节下一个视频: ${nextNIndex + 1}/${nCells.length}`, "color:#FF9800");
                        this.playCurrentIndex(nCells.get(nextNIndex));
                    } else {
                        const nextIndex = this._cellData.currentCellIndex + 1;
                        if (nextIndex >= cells.length) {
                            console.log("%c=====================================", "color:#4CAF50;font-size:16px");
                            console.log("%c==============本课程学习完成了==============", "color:#4CAF50;font-size:16px;font-weight:bold");
                            console.log("%c=====================================", "color:#4CAF50;font-size:16px");
                            this._nextUnitPending = false;
                            return;
                        }
                        console.log(`%c切换到下一个章节: ${nextIndex + 1}/${cells.length}`, "color:#FF9800");
                        this._cellData.currentCellIndex = nextIndex;
                        this._cellData.currentNCellIndex = 0;
                        this.playCurrentIndex();
                    }
                } catch (error) {
                    this._nextUnitPending = false;
                    console.error('切换下一小节失败:', error);
                }
            },
            _getKnowledgeTabs() {
                const selectors = ['#prev_tab li', '.prev_ul > li', '#prev .prev_list li'];
                for (const selector of selectors) {
                    const items = $(selector).filter((_, el) => $(el).find('.prev_white').length > 0);
                    if (items.length > 0) {
                        return items;
                    }
                }
                return $();
            },
            _findActiveTab(items) {
                let activeEl = items.filter('.active');
                if (activeEl.length === 0) {
                    activeEl = items.filter((_, el) => $(el).find('.active, .current, .selected, .on').length > 0);
                }
                return activeEl;
            },
            _advanceKnowledgePoint() {
                const items = this._getKnowledgeTabs();
                if (items.length < 2) {
                    return false;
                }

                const activeEl = this._findActiveTab(items);
                const activeId = activeEl.attr('id') || null;

                if (this._endedTabId && activeId && activeId !== this._endedTabId) {
                    console.log('%c平台已自动切换到下一个任务点，重新接管播放', 'color:#607D8B');
                    this._endedTabId = null;
                    this._nextUnitPending = false;
                    this._isPlaying = false;
                    this._clearCheckInterval();
                    this._reenterAfterSwitch(1500);
                    return true;
                }

                let index = items.index(activeEl);
                if (index < 0) {
                    const currentTitle = this._currentStepTitle();
                    if (currentTitle) {
                        index = items.index(items.filter((_, el) => ($(el).attr('title') || '').trim() === currentTitle));
                    }
                }
                if (index < 0) {
                    console.warn('%c未识别出当前任务点，交回目录树导航', 'color:#FF9800');
                    return false;
                }
                if (index + 1 >= items.length) {
                    console.log('%c当前是本小节的最后一个任务点，准备切换到下一小节', 'color:#607D8B');
                    return false;
                }

                const nextEl = items.get(index + 1);
                const nextTitle = ($(nextEl).attr('title') || $(nextEl).find('.spanText').text() || '未知任务点').trim();
                console.log(`%c切换本小节任务点: ${index + 2}/${items.length} - ${nextTitle}`, "color:#FF9800");

                this._endedTabId = null;
                this._nextUnitPending = false;
                this._isPlaying = false;
                this._clearCheckInterval();
                const clickTarget = $(nextEl).find('.prev_white').get(0) || nextEl;
                this._programmaticClick = true;
                clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                this._programmaticClick = false;
                this._reenterAfterSwitch(2000);
                return true;
            },
            _advanceTaskpoint() {
                if (this._advanceByContainer()) {
                    return true;
                }
                const containers = this._collectContainers('.ans-attach-ct.videoContainer');
                if (containers.length >= 1) {
                    console.log('%c本节以任务点容器顺序为准，不走标签条（避免跳知识点漏任务点）', "color:#9E9E9E");
                    return false;
                }
                return this._advanceKnowledgePoint();
            },
            _findInContainer(container, selectors) {
                const search = (root) => {
                    for (const selector of selectors) {
                        const hit = root.querySelector(selector);
                        if (hit) {
                            return hit;
                        }
                    }
                    const frames = root.querySelectorAll('iframe');
                    for (const frame of frames) {
                        let inner = null;
                        try {
                            inner = frame.contentDocument;
                        } catch (e) {
                            inner = null;
                        }
                        if (inner) {
                            const hit = search(inner);
                            if (hit) {
                                return hit;
                            }
                        }
                    }
                    return null;
                };
                return search(container);
            },
            _advanceByContainer() {
                const containers = this._collectContainers('.ans-attach-ct.videoContainer');
                if (containers.length < 2) {
                    return false;
                }
                const current = this._lastVideoEl || this._videoEl;
                let ci = -1;
                for (let i = 0; i < containers.length; i++) {
                    if (current && this._isInsideContainer(current, containers[i])) {
                        ci = i;
                        break;
                    }
                }
                if (ci < 0 || ci + 1 >= containers.length) {
                    return false;
                }
                const nextIndex = ci + 1;
                if (nextIndex === this._blacklistedContainer) {
                    return false;
                }
                const next = containers[nextIndex];
                const targetVideo = this._collectVideoCandidates().filter((v) => this._isInsideContainer(v, next))[0] || null;

                console.log(`%c本小节还有后续视频任务点（容器 ${nextIndex + 1}/${containers.length}），尝试激活`, "color:#FF9800");

                this._nextUnitPending = false;
                this._isPlaying = false;
                this._clearCheckInterval();
                this._detachVideoEvents();

                // 实测结论：堆叠的任务点播放器已经带 src（preload="none"），
                // 只需显式 load() + play() 就能拉起，平台自己的播放器 UI 也会跟着走。
                if (targetVideo && (targetVideo.src || targetVideo.currentSrc)) {
                    console.log('%c对该任务点的播放器执行 load() + play()', "color:#607D8B");
                    try {
                        targetVideo.load();
                    } catch (e) {}
                    this._videoEl = targetVideo;
                    this._lastVideoEl = targetVideo;
                    this._switchPending = false;
                    this._switchRetries = 0;
                    this._isPlaying = true;
                    this._videoEventHandle();
                    targetVideo.playbackRate = this.configs.playbackRate;
                    const playResult = targetVideo.play();
                    if (playResult && playResult.catch) {
                        playResult.catch((e) => {
                            console.warn('play() 被拒，交由保活循环重试:', e);
                        });
                    }
                    this._startVideoMonitoring();
                    return true;
                }

                console.log('%c目标播放器尚未就绪，改点它的播放按钮', "color:#607D8B");
                this._blacklistedContainer = nextIndex;
                this._switchPending = true;
                this._switchRetries = 0;
                this._videoEl = null;
                const clickTarget = this._findInContainer(next, ['.vjs-big-play-button', '.play-btn', '.playBtn', '.pv-cover', '.ans-video-cover', 'img']) || next;
                try {
                    clickTarget.scrollIntoView({ block: 'center' });
                } catch (e) {}
                clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                setTimeout(() => this.play(), 2000);
                return true;
            },
            async probeNextTaskpoint(dryRun) {
                const containers = this._collectContainers('.ans-attach-ct.videoContainer');
                console.log(`%c[探针] 找到 ${containers.length} 个视频容器`, 'color:#9C27B0;font-weight:bold');
                const current = this._lastVideoEl || this._videoEl;
                let ci = -1;
                for (let i = 0; i < containers.length; i++) {
                    if (current && this._isInsideContainer(current, containers[i])) {
                        ci = i;
                        break;
                    }
                }
                console.log(`[探针] 当前播放器位于容器 ${ci + 1}/${containers.length}`);

                const all = this._collectVideoCandidates();
                containers.forEach((c, i) => {
                    const vids = all.filter((v) => this._isInsideContainer(v, c));
                    const info = vids.length > 0
                        ? vids.map((v) => `rs=${v.readyState} dur=${(Number(v.duration) || 0).toFixed(1)} src=${(v.currentSrc || v.src || '(无)').slice(-40)}`).join(' ; ')
                        : '内部无 video';
                    console.log(`%c  容器[${i}] class="${c.className}" → ${info}`, 'color:#9E9E9E');
                });

                const next = containers[ci + 1];
                if (!next) {
                    console.log('%c[探针] 没有下一个容器，停止', 'color:#FF9800');
                    return null;
                }
                console.log('%c[探针] 下一个容器的内部 HTML（前 400 字）：', 'color:#9C27B0');
                console.log((next.innerHTML || '(空)').replace(/\s+/g, ' ').slice(0, 400));

                if (dryRun) {
                    console.log('%c[探针] dryRun 模式，不执行激活', 'color:#FF9800');
                    return null;
                }

                const findVideo = () => this._collectVideoCandidates().filter((v) => this._isInsideContainer(v, next))[0] || null;
                const strategies = [
                    ['A. video.load() + play()', () => {
                        const v = findVideo();
                        if (!v) return false;
                        try { v.load(); } catch (e) {}
                        v.play().catch(() => {});
                        return true;
                    }],
                    ['B. 点 .vjs-big-play-button', () => {
                        const el = this._findInContainer(next, ['.vjs-big-play-button']);
                        if (!el) return false;
                        el.click();
                        return true;
                    }],
                    ['C. 点封面/图片', () => {
                        const el = this._findInContainer(next, ['.pv-cover', '.ans-video-cover', 'img']);
                        if (!el) return false;
                        el.click();
                        return true;
                    }],
                    ['D. 点容器本身', () => {
                        next.click();
                        return true;
                    }]
                ];

                for (const [name, run] of strategies) {
                    console.log(`%c[探针] 尝试 ${name}`, 'color:#2196F3');
                    let ran = false;
                    try {
                        ran = run();
                    } catch (e) {
                        console.log('[探针] 策略抛错:', e);
                    }
                    if (!ran) {
                        console.log('%c[探针] 该策略不适用（找不到目标元素）', 'color:#9E9E9E');
                        continue;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 2500));
                    const after = findVideo();
                    const loaded = !!after && (Number(after.readyState) > 0 || Number(after.duration) > 0);
                    console.log(`%c[探针] ${name} 结果：readyState=${after ? after.readyState : 'n/a'} dur=${after ? (Number(after.duration) || 0).toFixed(1) : 'n/a'} paused=${after ? after.paused : 'n/a'} ${loaded ? '✅ 已加载' : '❌ 仍无数据'}`,
                        loaded ? 'color:#4CAF50' : 'color:#F44336');
                    if (loaded) {
                        console.log(`%c[探针] ✅ 有效策略是：${name}`, 'color:#4CAF50;font-weight:bold');
                        return name;
                    }
                }
                console.log('%c[探针] ❌ 4 种策略都无效，需要根据上面容器内部 HTML 另想办法', 'color:#F44336;font-weight:bold');
                return null;
            },
            _reenterAfterSwitch(delay) {
                this._switchPending = true;
                this._switchRetries = 0;
                this._videoEl = null;
                this._detachVideoEvents();
                setTimeout(() => {
                    try {
                        this._initCellData();
                    } catch (e) {}
                    this.play();
                }, delay);
            },
            dumpTabs() {
                const tabs = this._getKnowledgeTabs();
                const rows = [];
                tabs.each((i, el) => {
                    rows.push(`${i} | id=${el.id} | class="${el.className}" | title="${el.getAttribute('title') || ''}" | ` +
                        `text="${$(el).find('.spanText').text().trim()}" | liActive=${$(el).hasClass('active')} | innerActive=${$(el).find('.active').length}`);
                });
                console.log(`%c任务点标签 ${tabs.length} 个:\n${rows.join('\n')}`, "color:#2196F3");
                const containers = this._collectContainers('.ans-attach-ct.videoContainer');
                const allContainers = this._collectContainers('.ans-attach-ct');
                console.log(`%c.ans-attach-ct 顶层 ${$('.ans-attach-ct').length} 个 / 含 iframe 内共 ${allContainers.length} 个（其中视频容器 ${containers.length} 个）；标签条 ${tabs.length} 个`, "color:#2196F3");
                allContainers.slice(0, 8).forEach((el, i) => {
                    const cls = $(el).attr('class') || '';
                    const kind = cls.indexOf('videoContainer') >= 0 ? '视频' : '非视频';
                    const title = ($(el).find('.cardRightTit').first().text() || '').replace(/\s+/g, ' ').trim().slice(0, 26);
                    console.log(`%c  容器[${i}] ${kind} class="${cls}" 标题="${title}"`, "color:#9E9E9E");
                });
                const candidates = this._collectVideoCandidates();
                const loadedCount = candidates.filter((v) => Number(v.readyState) > 0 || Number(v.duration) > 0).length;
                console.log(`%c页面共发现 ${candidates.length} 个播放器 <video>（其中已加载元数据 ${loadedCount} 个）`, "color:#2196F3");
                candidates.forEach((v, i) => {
                    const tabIndex = this._videoContainerIndex(v);
                    console.log(`%c[${i}] t=${(Number(v.currentTime) || 0).toFixed(1)}/${(Number(v.duration) || 0).toFixed(1)} | paused=${v.paused} | ended=${v.ended} | 可见=${this._isElementVisible(v)} | 所属任务点序号=${tabIndex} | src=...${(v.currentSrc || v.src || '').slice(-50)}`, "color:#2196F3");
                });
                return tabs.length;
            },
            _clearCheckInterval() {
                if (this._checkInterval) {
                    clearInterval(this._checkInterval);
                    this._checkInterval = null;
                }
            },
            _startVideoMonitoring() {
                this._clearCheckInterval();
                this._guardLastTime = 0;
                this._guardLastWallTs = 0;
                this._guardLastResumeTs = 0;
                this._checkInterval = setInterval(() => {
                    this._checkVideoStatus();
                }, this.configs.videoCheckInterval);
            },
            _tryResumePlayback(reason) {
                const now = Date.now();
                if (now - this._guardLastResumeTs < this.configs.guardResumeCooldownMs) {
                    return;
                }
                this._guardLastResumeTs = now;

                const video = this._getVideoEl();
                if (!video || !this._isPlaying) return;

                console.log(`%c触发视频保活恢复(${reason})`, "color:#607D8B");
                video.play().catch((e) => {
                    console.warn("直接恢复播放失败，尝试静音恢复:", e);
                    video.muted = true;
                    video.play().catch((err) => {
                        console.error("静音恢复播放失败:", err);
                    });
                });
            },
            _checkVideoStatus() {
                try {
                    const video = this._getVideoEl();
                    if (!video) return;

                    if (video.paused && this._isPlaying) {
                        console.log("%c检测到视频暂停，尝试恢复播放...", "color:#FF5722");
                        this._tryResumePlayback("paused");
                    } else if (this._isPlaying && !video.ended) {
                        const now = Date.now();
                        const current = Number(video.currentTime || 0);
                        if (this._guardLastWallTs === 0) {
                            this._guardLastWallTs = now;
                            this._guardLastTime = current;
                        } else {
                            const stalled = Math.abs(current - this._guardLastTime) < 0.01;
                            const stalledMs = now - this._guardLastWallTs;
                            if (stalled && stalledMs >= this.configs.guardNoProgressMs) {
                                this._tryResumePlayback("no-progress");
                                this._guardLastWallTs = now;
                                this._guardLastTime = Number(video.currentTime || 0);
                            } else if (!stalled) {
                                this._guardLastWallTs = now;
                                this._guardLastTime = current;
                            }
                        }
                    }

                    if (video.ended && this._isPlaying) {
                        console.log("%c检测到视频结束，准备切换下一个...", "color:#9C27B0");
                        this._isPlaying = false;
                        setTimeout(() => this.nextUnit(), 1000);
                    }
                } catch (e) {
                    console.error("视频状态检查失败:", e);
                }
            },
            _tryTimes: 0,
            _stepAdvanceTimes: 0,
            _stepSwitchAt: 0,
            _stepSwitchPending: false,
            _delayedNextUnitTimer: null,
            _guardLastTime: 0,
            _guardLastWallTs: 0,
            _guardLastResumeTs: 0,
            async play() {
                try {
                    const el = this._getVideoEl();
                    if (el == null) {
                        if (this._switchPending && this._switchRetries < 15) {
                            this._switchRetries++;
                            console.log(`%c等待新任务点视频加载中... (${this._switchRetries}/15)`, "color:#607D8B");
                            setTimeout(() => {
                                this.play();
                            }, 1000);
                            return;
                        }
                        if (this._switchPending) {
                            this._switchPending = false;
                            if (this._switchSkipCount < 10) {
                                this._switchSkipCount++;
                                console.log('%c该任务点未检测到视频，尝试跳到下一个任务点', "color:#FF9800");
                                if (this._advanceTaskpoint()) {
                                    return;
                                }
                            }
                        }
                        if (this._currentStepTitle() === '视频') {
                            throw new Error('视频组件尚未加载完成');
                        }
                        if (this._advanceLearningStep()) {
                            console.log("%c当前不在视频页，已尝试切到下一学习步骤，2秒后重试", "color:#607D8B");
                            setTimeout(() => {
                                this.play();
                            }, 2000);
                            return;
                        }
                        if (this._isChapterTest()) {
                            this._advanceChapterTest();
                            return;
                        }
                        this._isPlaying = false;
                        this._clearCheckInterval();
                        if (this.configs.autoAdvanceNoVideo) {
                            console.warn('%c当前小节未发现视频，按配置切换到下一小节', 'color:#FF9800');
                            this.nextUnit();
                        } else {
                            console.warn('%c当前小节未发现视频或可识别的学习步骤，已安全停止。确认无需完成课件后，可执行 app.nextUnit()。', 'color:#FF9800');
                        }
                        return;
                    }

                    this._isPlaying = true;
                    this._switchPending = false;
                    this._switchRetries = 0;
                    this._switchSkipCount = 0;
                    this._lastVideoEl = el;
                    this._videoEventHandle();
                    el.playbackRate = this.configs.playbackRate;

                    try {
                        await el.play();
                        this._tryTimes = 0;
                        console.log(`%c视频开始播放，倍速: ${el.playbackRate}x`, "color:#4CAF50");
                        this._startVideoMonitoring();
                    } catch (playError) {
                        console.error("视频播放失败:", playError);
                        this._handlePlayError(playError);
                    }
                } catch (e) {
                    if (this._tryTimes >= this.configs.maxRetries) {
                        console.error("%c视频播放失败，已达到最大重试次数", "color:#F44336;font-weight:bold", e);
                        this._clearCheckInterval();
                        return;
                    }
                    this._tryTimes++;
                    console.log(`%c播放失败，${this.configs.retryInterval/1000}秒后重试 (${this._tryTimes}/${this.configs.maxRetries})`, "color:#FF9800");
                    setTimeout(() => {
                        this.play();
                    }, this.configs.retryInterval);
                }
            },
            _advanceLearningStep() {
                if (this._stepSwitchPending && Date.now() - this._stepSwitchAt < 4000) {
                    return true;
                }

                const prevTitle = document.getElementsByClassName("prev_title")[0];
                const currentStepTitle = prevTitle ? (prevTitle.title || prevTitle.textContent || "").trim() : "";

                if (currentStepTitle === "章节测验" || currentStepTitle === "视频") {
                    return false;
                }

                const clickElement = (el, label) => {
                    if (!el) return false;
                    this._stepSwitchPending = true;
                    this._stepSwitchAt = Date.now();
                    console.log(`%c尝试点击${label}`, "color:#2196F3");
                    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
                    return true;
                };

                const videoTab = $(".prev_white:visible").filter((_, el) => {
                    const text = ($(el).text() || "").replace(/\s+/g, "");
                    return text === "2视频" || text === "视频";
                }).get(0);
                if (clickElement(videoTab, "“视频”页签")) {
                    return true;
                }

                return false;
            },
            _currentStepTitle() {
                const prevTitle = document.getElementsByClassName('prev_title')[0];
                return prevTitle ? (prevTitle.title || prevTitle.textContent || '').trim() : '';
            },
            _isChapterTest() {
                return this._currentStepTitle() === '章节测验';
            },
            _advanceChapterTest() {
                if (this._chapterAdvanceTimes >= 3) {
                    console.error('%c章节测验页面连续跳转失败，已停止以避免页面循环。请手动处理后执行 app.run()。', 'color:#F44336;font-weight:bold');
                    return;
                }

                const nextButton = $('#prevNextFocusNext:visible, #right1:visible, .nextChapter:visible').first().get(0);
                if (!nextButton) {
                    console.warn('%c未找到章节测验的下一步按钮，已停止。', 'color:#FF9800');
                    return;
                }

                this._chapterAdvanceTimes++;
                console.log('%c检测到章节测验，尝试进入下一学习步骤', 'color:#607D8B');
                nextButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                setTimeout(() => this.play(), 2000);
            },
            _bindStepNavigation() {
                if (this._stepNavigationBound) {
                    return;
                }
                this._stepNavigationBound = true;

                const reenterVideoMode = () => {
                    this._isPlaying = false;
                    this._stepSwitchPending = true;
                    this._stepSwitchAt = Date.now();
                    this._reenterAfterSwitch(1800);
                };

                $(document).off('click.xuexitongPlayerV3', '.prev_white').on('click.xuexitongPlayerV3', '.prev_white', (e) => {
                    if (this._programmaticClick) {
                        return;
                    }
                    const $tab = $(e.currentTarget);
                    const text = ($tab.text() || "").replace(/\s+/g, "");
                    const isKnowledgeTab = $tab.closest('#prev_tab, .prev_list, .prev_ul').length > 0 ||
                        $tab.find('.spanText').length > 0;
                    if (isKnowledgeTab || text.includes("视频")) {
                        console.log(`%c检测到步骤/任务点切换点击：${text}，准备重新接管视频页`, "color:#607D8B");
                        reenterVideoMode();
                    }
                });
            },
            _handlePlayError(error) {
                console.error("播放错误详情:", error);
                const video = this._getVideoEl();
                if (video) {
                    video.muted = true;
                    video.play().then(() => {
                        console.log("%c静音播放成功", "color:#4CAF50");
                        this._tryTimes = 0;
                        this._startVideoMonitoring();
                        if (this._delayedNextUnitTimer) {
                            clearTimeout(this._delayedNextUnitTimer);
                            this._delayedNextUnitTimer = null;
                        }
                    }).catch(e => {
                        console.error("静音播放也失败:", e);
                        if (this._delayedNextUnitTimer) {
                            clearTimeout(this._delayedNextUnitTimer);
                        }
                        this._isPlaying = false;
                        if (this._tryTimes >= this.configs.maxRetries) {
                            console.error('%c静音播放失败，已达到最大重试次数', 'color:#F44336;font-weight:bold', e);
                            return;
                        }
                        this._tryTimes++;
                        this._delayedNextUnitTimer = setTimeout(() => {
                            this._delayedNextUnitTimer = null;
                            this.play();
                        }, this.configs.retryInterval);
                    });
                }
            },
            playCurrentIndex(nCell) {
                this._nextUnitPending = false;
                if (!nCell) {
                    const el = this._getTreeContainer();
                    const cells = el.children("ul").children("li");
                    const nCells = $(cells.get(this._cellData.currentCellIndex)).find('.posCatalog_select:not(.firstLayer)');
                    nCell = nCells.get(this._cellData.currentNCellIndex);
                }

                const $nCell = $(nCell);
                const clickableSpan = $nCell.find(".posCatalog_name")[0];
                if (!clickableSpan) {
                    console.error("%c===========找不到可点击的课程节点，播放下一个视频失败==============", "color:#F44336");
                    return;
                }

                console.log(`%c点击切换到: ${$(clickableSpan).attr('title') || '未知标题'}`, "color:#2196F3");
                $(clickableSpan).click();
                this._videoEl = null;
                this._isPlaying = false;
                this._switchPending = true;
                this._switchRetries = 0;

                console.log("%c等待视频加载...", "color:#FF9800");
                setTimeout(() => {
                    this._initCellData();
                    if (this.configs.autoplay) {
                        this.play();
                    }
                }, 3000);
            },
            _initCellData() {
                const el = this._getTreeContainer();
                const cells = el.children("ul").children("li");
                this._cellData.cells = cells.length;
                let nCellCounts = 0;
                let foundCurrent = false;

                cells.each((i, v) => {
                    const nCells = $(v).find('.posCatalog_select:not(.firstLayer)');
                    nCellCounts += nCells.length;
                    nCells.each((j, e) => {
                        const _el = $(e);
                        if (_el.hasClass("posCatalog_active")) {
                            this._cellData.currentCellIndex = i;
                            this._cellData.currentNCellIndex = j;
                            foundCurrent = true;
                            const titleSpan = _el.find('.posCatalog_name')[0];
                            if (titleSpan) {
                                this._cellData.currentVideoTitle = $(titleSpan).attr('title');
                            }
                        }
                    });
                });

                this._cellData.nCells = nCellCounts;

                if (!foundCurrent && nCellCounts > 0) {
                    console.warn("%c未找到当前激活的视频节点，可能需要手动选择", "color:#FF9800");
                }

                console.log(`%c课程信息: ${this._cellData.cells}章, ${this._cellData.nCells}节, 当前: 第${this._cellData.currentCellIndex + 1}章第${this._cellData.currentNCellIndex + 1}节`, "color:#607D8B");
            },
            _getTreeContainer() {
                if (!this._treeContainerEl) {
                    const el = $('#coursetree');
                    if (el.length <= 0) {
                        throw new Error("找不到视频列表");
                    }
                    this._treeContainerEl = el;
                }
                return this._treeContainerEl;
            },
            _collectVideoCandidates() {
                const found = [];
                const walk = (doc, depth) => {
                    if (!doc || depth > 4) {
                        return;
                    }
                    const $doc = $(doc);
                    $doc.find('video#video_html5_api, video[id*="video_html5"]').each((_, v) => {
                        if (found.indexOf(v) < 0) {
                            found.push(v);
                        }
                    });
                    $doc.find('iframe').each((_, frame) => {
                        let inner = null;
                        try {
                            inner = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
                        } catch (e) {
                            inner = null;
                        }
                        if (inner) {
                            walk(inner, depth + 1);
                        }
                    });
                };
                try {
                    walk(document, 0);
                } catch (e) {
                    console.error('收集播放器失败:', e);
                }
                return found;
            },
            _collectContainers(selector) {
                const found = [];
                const walk = (doc, depth) => {
                    if (!doc || depth > 4) {
                        return;
                    }
                    const $doc = $(doc);
                    $doc.find(selector).each((_, el) => {
                        if (found.indexOf(el) < 0) {
                            found.push(el);
                        }
                    });
                    $doc.find('iframe').each((_, frame) => {
                        let inner = null;
                        try {
                            inner = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
                        } catch (e) {
                            inner = null;
                        }
                        if (inner) {
                            walk(inner, depth + 1);
                        }
                    });
                };
                try {
                    walk(document, 0);
                } catch (e) {
                    console.error('收集任务点容器失败:', e);
                }
                return found;
            },
            _isElementVisible(el) {
                let current = el;
                for (let i = 0; i < 8 && current; i++) {
                    const doc = current.ownerDocument;
                    if (!doc) {
                        return true;
                    }
                    const win = doc.defaultView;
                    try {
                        const style = win.getComputedStyle(current);
                        if (style.display === 'none' || style.visibility === 'hidden') {
                            return false;
                        }
                    } catch (e) {}
                    if (typeof current.getBoundingClientRect === 'function') {
                        const rect = current.getBoundingClientRect();
                        if (rect.width === 0 || rect.height === 0) {
                            return false;
                        }
                    }
                    const frame = win && win.frameElement;
                    if (!frame) {
                        return true;
                    }
                    current = frame;
                }
                return true;
            },
            _isInsideContainer(el, container) {
                let doc = el.ownerDocument;
                for (let i = 0; i < 8 && doc; i++) {
                    const win = doc.defaultView;
                    const frame = win && win.frameElement;
                    if (!frame) {
                        return false;
                    }
                    if (container.contains(frame)) {
                        return true;
                    }
                    doc = frame.ownerDocument;
                }
                return false;
            },
            _videoContainerIndex(video) {
                const containers = this._collectContainers('.ans-attach-ct.videoContainer');
                for (let i = 0; i < containers.length; i++) {
                    if (this._isInsideContainer(video, containers[i])) {
                        return i + 1;
                    }
                }
                return -1;
            },
            _getVideoByActiveTab(candidates) {
                const items = this._getKnowledgeTabs();
                if (items.length < 1) {
                    return null;
                }
                const index = items.index(this._findActiveTab(items));
                if (index < 0) {
                    return null;
                }
                const containers = this._collectContainers('.ans-attach-ct.videoContainer');
                if (containers.length !== items.length) {
                    return null;
                }
                const container = containers[index];
                if (!container) {
                    return null;
                }
                const video = candidates.filter((v) => this._isInsideContainer(v, container))[0] || null;
                if (video && video === this._lastVideoEl && Number(video.currentTime) > 1) {
                    return null;
                }
                return video;
            },
            _getVideoEl() {
                if (this._videoEl && this._videoEl.isConnected) {
                    return this._videoEl;
                }

                const candidates = this._collectVideoCandidates();
                if (candidates.length === 0) {
                    return null;
                }

                // 页面会为每个任务点预先创建 <video>，但只有当前任务点的那个真正加载了元数据
                const loaded = candidates.filter((v) => Number(v.readyState) > 0 || Number(v.duration) > 0);
                const pool = loaded.length > 0 ? loaded : candidates;
                const isFresh = (v) => !v.ended && (v !== this._lastVideoEl || Number(v.currentTime) <= 1);

                if (this._switchPending) {
                    const fresh = pool.filter(isFresh);
                    if (fresh.length > 0) {
                        const pick = this._getVideoByActiveTab(fresh) ||
                            fresh.filter((v) => this._isElementVisible(v))[0] || fresh[0];
                        this._videoEl = pick;
                        console.log(`%c已在 ${candidates.length} 个播放器中找到新任务点的播放器`, "color:#607D8B");
                        return this._videoEl;
                    }
                    // 兼容性兜底：切小节/知识点时不能因为"没找到理想的新播放器"就返回 null。
                    // 旧版是"拿到哪个用哪个"，所以能继续往下走；严格返回 null 会让它停住。
                    const fallback = pool.filter((v) => !v.ended && (v.src || v.currentSrc))[0] ||
                        pool.filter((v) => !v.ended)[0] ||
                        pool[0];
                    this._videoEl = fallback;
                    console.log('%c未找到理想的新播放器，退回可用播放器（避免卡住）', "color:#FF9800");
                    return this._videoEl;
                }

                if (pool.length === 1) {
                    this._videoEl = pool[0];
                    return this._videoEl;
                }

                let pick = this._getVideoByActiveTab(pool);
                let how = '当前任务点容器';
                if (!pick) {
                    pick = pool.filter((v) => this._isElementVisible(v) && isFresh(v))[0] || null;
                    how = '可见且未结束';
                }
                if (!pick) {
                    pick = pool.filter((v) => this._isElementVisible(v) && !v.ended)[0] || null;
                    how = '可见且未结束(含上次)';
                }
                if (!pick) {
                    pick = pool.filter((v) => this._isElementVisible(v))[0] || null;
                    how = '可见';
                }
                if (!pick) {
                    pick = pool[0];
                    how = '第一个已加载';
                }

                this._videoEl = pick;
                console.log(`%c${candidates.length} 个播放器（已加载 ${loaded.length} 个），按「${how}」选中`, "color:#607D8B");
                return this._videoEl;
            },
            _videoEventHandle() {
                const el = this._videoEl;
                if (!el) {
                    console.log("videoEl未加载");
                    return;
                }

                if (this._eventVideoEl === el) return;
                this._detachVideoEvents();
                this._eventVideoEl = el;
                this._boundVideoHandlers = {
                    ended: this._handleVideoEnded.bind(this),
                    loadedmetadata: this._handleVideoLoaded.bind(this),
                    play: this._handleVideoPlay.bind(this),
                    pause: this._handleVideoPause.bind(this),
                };

                el.addEventListener('ended', this._boundVideoHandlers.ended);
                el.addEventListener('loadedmetadata', this._boundVideoHandlers.loadedmetadata);
                el.addEventListener('play', this._boundVideoHandlers.play);
                el.addEventListener('pause', this._boundVideoHandlers.pause);
            },
            _detachVideoEvents() {
                if (!this._eventVideoEl || !this._boundVideoHandlers) return;
                this._eventVideoEl.removeEventListener('ended', this._boundVideoHandlers.ended);
                this._eventVideoEl.removeEventListener('loadedmetadata', this._boundVideoHandlers.loadedmetadata);
                this._eventVideoEl.removeEventListener('play', this._boundVideoHandlers.play);
                this._eventVideoEl.removeEventListener('pause', this._boundVideoHandlers.pause);
                this._eventVideoEl = null;
                this._boundVideoHandlers = null;
            },
            _handleVideoEnded(e) {
                const title = this._cellData.currentVideoTitle;
                console.warn(`%c============'${title}' 播放完成=============`, "color:#4CAF50;font-weight:bold");
                this._isPlaying = false;
                this._clearCheckInterval();
                this._endedTabId = this._getKnowledgeTabs().filter('.active').attr('id') || null;
                setTimeout(() => this.nextUnit(), 1000);
            },
            _handleVideoLoaded(e) {
                console.log(`%c============视频加载完成=============`, "color:#2196F3");
                if (this.configs.autoplay && !this._isPlaying) {
                    this.play();
                }
            },
            _handleVideoPlay(e) {
                const title = this._cellData.currentVideoTitle;
                console.info(`%c============'${title}' 开始播放=============`, "color:#4CAF50");
                this._isPlaying = true;
                this._stepSwitchPending = false;
                const video = this._getVideoEl();
                this._guardLastTime = Number(video?.currentTime || 0);
                this._guardLastWallTs = Date.now();
                if (this._delayedNextUnitTimer) {
                    clearTimeout(this._delayedNextUnitTimer);
                    this._delayedNextUnitTimer = null;
                }
            },
            _handleVideoPause(e) {
                console.log(`%c============视频暂停=============`, "color:#FF9800");
            },
            _bindPageGuards() {
                const preventPause = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                };
                const resumePlaybackNow = () => this._tryResumePlayback('page-event');
                this._pageGuards = { preventPause, resumePlaybackNow };
                document.addEventListener('mouseleave', preventPause);
                window.addEventListener('mouseleave', preventPause);
                document.addEventListener('mouseout', preventPause);
                window.addEventListener('mouseout', preventPause);
                window.addEventListener('blur', resumePlaybackNow);
                document.addEventListener('visibilitychange', resumePlaybackNow);
            },
            destroy() {
                this._isPlaying = false;
                this._clearCheckInterval();
                this._detachVideoEvents();
                if (this._delayedNextUnitTimer) clearTimeout(this._delayedNextUnitTimer);
                $(document).off('.xuexitongPlayerV3');
                if (this._pageGuards) {
                    const { preventPause, resumePlaybackNow } = this._pageGuards;
                    document.removeEventListener('mouseleave', preventPause);
                    window.removeEventListener('mouseleave', preventPause);
                    document.removeEventListener('mouseout', preventPause);
                    window.removeEventListener('mouseout', preventPause);
                    window.removeEventListener('blur', resumePlaybackNow);
                    document.removeEventListener('visibilitychange', resumePlaybackNow);
                    this._pageGuards = null;
                }
            },
        };

        window.app = app;
        window[APP_KEY] = app;

        try {
            app.run();
            app._bindPageGuards();
        } catch (error) {
            console.error("%c脚本运行失败: ", "color:#F44336;font-weight:bold", error.message);
            console.log("请检查是否在正确的课程播放页面，或者页面结构是否再次发生改变。");
        }
    }
})();
