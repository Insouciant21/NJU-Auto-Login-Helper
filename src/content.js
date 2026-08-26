import { init as ocrInit, recognise } from "./captcha-ocr.js";
import { findSliderOffset, dragSlider } from "./slider-captcha.js";

(function () {
  "use strict";

  var DEFAULT_SETTINGS = {
    studentId: "",
    password: "",
    autoFill: true,
    autoCaptcha: true,
    autoLogin: true
  };

  var selectors = {
    username: [
      "#username",
      "input[name='username']",
      "input[name='userName']",
      "input[type='text'][autocomplete='username']"
    ],
    password: [
      "#password",
      "input[name='password']",
      "input[type='password']"
    ],
    captchaInput: [
      "#captchaResponse",
      "#captcha",
      "input[name='captchaResponse']",
      "input[name='captcha']",
      "input[placeholder*='验证码']",
      "input[aria-label*='验证码']"
    ],
    captchaImage: [
      "#captchaImg",
      "img[id*='captcha' i]",
      "img[src*='captcha' i]"
    ],
    login: [
      "#pwdLoginDiv #login_submit",
      "#pwdLoginDiv a[onclick*='startLogin']",
      "#pwdLoginDiv .login-btn",
      "#casLoginForm button[type='submit']",
      "#casLoginForm input[type='submit']",
      "button[type='submit']",
      "input[type='submit']",
      "button[name='submit']",
      "#loginButton",
      "#submit",
      "a[onclick*='startLogin']"
    ]
  };

  function isVisible(node) {
    if (!node) return false;
    var style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    var rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function queryFirst(candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var nodes = document.querySelectorAll(candidates[i]);
      for (var j = 0; j < nodes.length; j++) {
        if (isVisible(nodes[j])) return nodes[j];
      }
    }
    return null;
  }

  function isUsableButton(node) {
    if (!isVisible(node)) return false;
    if (node.disabled || node.getAttribute("aria-disabled") === "true") return false;
    return true;
  }

  function findLoginButton() {
    for (var i = 0; i < selectors.login.length; i++) {
      var matched = document.querySelectorAll(selectors.login[i]);
      for (var j = 0; j < matched.length; j++) {
        if (isUsableButton(matched[j])) return matched[j];
      }
    }
    var candidates = document.querySelectorAll("button, input[type='button'], input[type='submit'], [role='button'], a");
    for (var k = 0; k < candidates.length; k++) {
      if (!isUsableButton(candidates[k])) continue;
      var text = (candidates[k].textContent || candidates[k].value || "").trim();
      if (text === "登录") return candidates[k];
    }
    return null;
  }

  function setNativeValue(input, value) {
    if (input.value === value) return false;
    var prototype = Object.getPrototypeOf(input);
    var descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function addStatus(text, type) {
    var el = document.querySelector(".nju-autologin-status");
    if (!el) {
      el = document.createElement("div");
      el.className = "nju-autologin-status";
      document.documentElement.appendChild(el);
    }
    var statusType = type || "info";
    if (el.textContent !== text) el.textContent = text;
    if (el.dataset.type !== statusType) el.dataset.type = statusType;
    if (el._njuStatusTimer) window.clearTimeout(el._njuStatusTimer);
    var statusElement = el;
    el._njuStatusTimer = window.setTimeout(function () {
      if (statusElement && statusElement.parentNode) statusElement.parentNode.removeChild(statusElement);
      statusElement._njuStatusTimer = null;
    }, 5000);
  }

  // ── Captcha OCR ──────────────────────────────────────────────────

  var _lastCaptchaUrl = "";
  var _lastSubmittedCaptchaUrl = "";
  var _lastSliderKey = "";
  var _sliderInFlightKey = "";
  var _sliderRequestId = 0;
  var _captchaRequestId = 0;
  var _captchaInFlightSource = "";
  var _captchaRetrySource = "";
  var _captchaRetryCount = 0;
  var _sliderRefreshPending = false;
  var _sliderRetryCount = 0;
  var _loginPrimed = false;
  var _runPending = false;

  function invokeLoginButton(button) {
    if (!isUsableButton(button)) return false;
    var javascriptLink = button.tagName === "A" &&
      /^javascript:/i.test(button.getAttribute("href") || "");
    if (javascriptLink && !button.dataset.njuLoginGuard) {
      button.addEventListener("click", function (event) {
        // The page uses href="javascript:void(0)". Keep its inline onclick
        // handler, but suppress the CSP-blocked default navigation.
        event.preventDefault();
      }, true);
      button.dataset.njuLoginGuard = "1";
    }
    button.click();
    return true;
  }

  function findSliderRefreshButton() {
    return document.querySelector("#sliderDiv .refreshIcon") ||
      document.querySelector("#sliderCaptchaDiv .captcha-refresh");
  }

  function getSliderKey() {
    var background = document.querySelector("#slider-img1");
    var piece = document.querySelector("#slider-img2");
    if (!background || !piece || !background.src || !piece.src) return "";
    return (background.currentSrc || background.src) + "|" +
      (piece.currentSrc || piece.src);
  }

  function scheduleSliderRefresh(settings) {
    if (_sliderRefreshPending || _sliderRetryCount >= 3) return false;
    var refresh = findSliderRefreshButton();
    if (!refresh) return false;
    var previousKey = getSliderKey();
    _sliderRefreshPending = true;
    _sliderRetryCount += 1;
    _lastSliderKey = "";
    _sliderRequestId += 1;
    window.setTimeout(function () {
      try {
        var currentRefresh = findSliderRefreshButton();
        if (currentRefresh) currentRefresh.click();
      } finally {
        // The page's refresh action is asynchronous. Do not process the old
        // image while the request is still in flight; the source-image
        // observer and this delayed check both wait for a new pair.
        window.setTimeout(function () {
          _sliderRefreshPending = false;
          var currentKey = getSliderKey();
          if (currentKey && currentKey !== previousKey) {
            _lastSliderKey = "";
            trySlideCaptcha(settings);
          } else if (_sliderRetryCount < 3) {
            scheduleSliderRefresh(settings);
          } else {
            addStatus("NJU Helper: 刷新验证码超时，请手动拖动", "warning");
          }
        }, 1200);
      }
    }, 250);
    return true;
  }

  function sliderContainersText() {
    var roots = document.querySelectorAll("#sliderDiv, #sliderCaptchaDiv");
    var text = [];
    for (var i = 0; i < roots.length; i++) text.push(roots[i].textContent || "");
    return text.join(" ").replace(/\s+/g, " ").trim();
  }

  function hasVisibleSliderContainer() {
    var roots = document.querySelectorAll("#sliderDiv, #sliderCaptchaDiv");
    for (var i = 0; i < roots.length; i++) {
      if (isVisible(roots[i])) return true;
    }
    return false;
  }

  function waitForSliderResult() {
    return new Promise(function (resolve) {
      var done = false;
      var started = Date.now();
      var observer = new MutationObserver(check);
      var timeoutId = 0;
      var checkTimerId = 0;
      var finish = function (state) {
        if (done) return;
        done = true;
        observer.disconnect();
        if (checkTimerId) window.clearTimeout(checkTimerId);
        if (timeoutId) window.clearTimeout(timeoutId);
        resolve(state);
      };
      function check() {
        if (done) return;
        var roots = document.querySelectorAll("#sliderDiv, #sliderCaptchaDiv");
        for (var i = 0; i < roots.length; i++) {
          if (roots[i].querySelector(".sliderContainer_success") ||
              roots[i].classList.contains("sliderContainer_success")) {
            finish("success");
            return;
          }
          if (roots[i].querySelector(".sliderContainer_fail") ||
              roots[i].classList.contains("sliderContainer_fail")) {
            finish("failed");
            return;
          }
        }
        var text = sliderContainersText();
        if (/验证(?:码)?(?:错误|失败)|滑动(?:验证)?(?:错误|失败)|请重新|重新验证|不正确/.test(text)) {
          finish("failed");
          return;
        }
        if (/验证(?:码)?(?:成功|通过)|校验成功/.test(text)) {
          finish("success");
          return;
        }
        if (Date.now() - started >= 150 && !hasVisibleSliderContainer()) {
          finish("success");
        }
      }
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "aria-hidden"]
      });
      checkTimerId = window.setTimeout(check, 150);
      timeoutId = window.setTimeout(function () { finish("timeout"); }, 6000);
    });
  }

  async function trySlideCaptcha(settings) {
    if (!settings.autoCaptcha || _sliderRefreshPending) return false;
    // NJU keeps these as hidden source images; the visible canvas and handle
    // live inside #sliderDiv.
    var background = document.querySelector("#slider-img1");
    var piece = document.querySelector("#slider-img2");
    var slider = document.querySelector("#sliderDiv .slider");
    var container = document.querySelector("#sliderDiv");
    if (!background || !piece || !slider || !container ||
        !background.src || !piece.src ||
        !isVisible(container) || !isVisible(slider)) return false;
    var key = getSliderKey();
    var backgroundSource = background.currentSrc || background.src;
    var pieceSource = piece.currentSrc || piece.src;
    if (key === _lastSliderKey || key === _sliderInFlightKey) return false;
    _lastSliderKey = key;
    _sliderInFlightKey = key;
    var requestId = ++_sliderRequestId;
    var isCurrent = function () {
      return requestId === _sliderRequestId && background.isConnected &&
        piece.isConnected && slider.isConnected &&
        (background.currentSrc || background.src) === backgroundSource &&
        (piece.currentSrc || piece.src) === pieceSource;
    };

    try {
      var canvas = container.querySelector("canvas");
      var canvasRect = canvas && canvas.getBoundingClientRect();
      var backgroundWidth = (canvasRect && canvasRect.width) ||
        background.getBoundingClientRect().width || container.clientWidth || 278;
      var result = await findSliderOffset(background, piece, backgroundWidth);
      if (!isCurrent()) return false;
      console.info("[NJU Helper] Slider match:", JSON.stringify(result));
      if (!Number.isFinite(result.score) || result.score < 0.24) {
        var confidence = Number.isFinite(result.score) ? result.score.toFixed(3) : "invalid";
        if (scheduleSliderRefresh(settings)) {
          addStatus("NJU Helper: 验证码图像置信度过低，正在刷新…", "warning");
        } else {
          addStatus("NJU Helper: 多次识别置信度过低，请手动拖动", "warning");
        }
        console.warn("[NJU Helper] Slider confidence too low:", confidence);
        return false;
      }
      _sliderRetryCount = 0;
      addStatus("NJU Helper: 正在识别滑块…", "info");
      await dragSlider(slider, result.offset);
      var verification = await waitForSliderResult();
      if (verification === "success") {
        addStatus("NJU Helper: 已完成滑块验证", "success");
        return true;
      }
      _lastSliderKey = "";
      if (verification === "failed") {
        // longbow.slidercaptcha already calls openSliderCaptcha() after a
        // failed secure verification. Let its new image trigger our source
        // watcher; only use our refresh button as a delayed fallback so the
        // two refresh requests do not race each other.
        addStatus("NJU Helper: 滑块验证失败，等待验证码刷新…", "warning");
        window.setTimeout(function () {
          if (getSliderKey() === key && !_sliderInFlightKey && !_sliderRefreshPending &&
              scheduleSliderRefresh(settings)) {
            addStatus("NJU Helper: 页面未刷新验证码，正在重试…", "warning");
          }
        }, 1800);
      } else {
        addStatus("NJU Helper: 等待页面确认超时，请手动检查", "warning");
      }
      return false;
    } catch (err) {
      if (_lastSliderKey === key) _lastSliderKey = "";
      console.error("[NJU Helper] Slider captcha failed:", (err && err.message) || err);
      addStatus("NJU Helper: 滑块识别失败，请手动拖动", "warning");
      return false;
    } finally {
      if (_sliderInFlightKey === key) _sliderInFlightKey = "";
    }
  }

  async function tryRecogniseCaptcha(captchaImage, captchaInput, settings) {
    if (!settings.autoCaptcha) return false;
    var src = captchaImage.currentSrc || captchaImage.src;
    if (!src || src === _lastCaptchaUrl || src === _captchaInFlightSource) return false;
    if (_captchaRetrySource !== src) {
      _captchaRetrySource = src;
      _captchaRetryCount = 0;
    }
    _lastCaptchaUrl = src;
    _captchaInFlightSource = src;
    var requestId = ++_captchaRequestId;
    var currentSource = function () { return captchaImage.currentSrc || captchaImage.src; };
    var isCurrent = function () {
      return requestId === _captchaRequestId && captchaImage.isConnected &&
        captchaInput.isConnected && currentSource() === src;
    };
    var retryLater = function () {
      if (_captchaRetryCount >= 2 || currentSource() !== src) return;
      _captchaRetryCount += 1;
      _lastCaptchaUrl = "";
      window.setTimeout(function () {
        if (captchaImage.isConnected && currentSource() === src) {
          tryRecogniseCaptcha(captchaImage, captchaInput, settings);
        }
      }, 1200);
    };

    var success = false;
    try {
      try {
        await ocrInit(chrome.runtime.getURL("dist/ddddocr"));
      } catch (err) {
        console.error("[NJU Helper] OCR init failed:", (err && err.message) || err);
        if (isCurrent()) {
          addStatus("NJU Helper: 模型加载失败，正在重试…", "warning");
          retryLater();
        }
        return false;
      }
      if (!isCurrent()) return false;

      captchaImage.classList.add("nju-autologin-captcha--loading");
      try {
        var result = await recognise(captchaImage);
        if (!isCurrent()) return false;
        if (result && /^[0-9A-Za-z]{4,}$/.test(result.text)) {
          setNativeValue(captchaInput, result.text);
          _captchaRetryCount = 0;
          success = true;
          addStatus("NJU Helper: 已自动识别验证码", "success");

          if (settings.autoLogin) {
            window.setTimeout(function () {
              if (isCurrent() && _lastSubmittedCaptchaUrl !== src) {
                var loginBtn = findLoginButton();
                if (loginBtn) {
                  _lastSubmittedCaptchaUrl = src;
                  if (invokeLoginButton(loginBtn)) {
                    addStatus("NJU Helper: 已自动登录", "success");
                  }
                }
              }
            }, 400);
          }

          return true;
        }
        if (isCurrent()) retryLater();
      } catch (err) {
        console.error("[NJU Helper] OCR failed:", (err && err.message) || err);
        if (isCurrent()) retryLater();
      }
      return false;
    } finally {
      if (captchaImage.isConnected) captchaImage.classList.remove("nju-autologin-captcha--loading");
      if (!success && isCurrent()) _lastCaptchaUrl = "";
      if (_captchaInFlightSource === src) _captchaInFlightSource = "";
    }
  }

  function watchCaptchaRefresh(captchaImage, captchaInput, settings) {
    if (!captchaImage || captchaImage.dataset.njuOcrWatched) return;
    captchaImage.dataset.njuOcrWatched = "1";
    new MutationObserver(function () {
      _captchaRequestId += 1;
      _lastCaptchaUrl = "";
      _captchaRetrySource = "";
      _captchaRetryCount = 0;
      window.setTimeout(function () {
        tryRecogniseCaptcha(captchaImage, captchaInput, settings);
      }, 500);
    }).observe(captchaImage, { attributes: true, attributeFilter: ["src"] });
  }

  function watchSliderRefresh(settings) {
    var images = document.querySelectorAll("#slider-img1, #slider-img2");
    for (var i = 0; i < images.length; i++) {
      var image = images[i];
      if (image.dataset.njuSliderWatched) continue;
      image.dataset.njuSliderWatched = "1";
      new MutationObserver(function () {
        _sliderRequestId += 1;
        _lastSliderKey = "";
        _sliderInFlightKey = "";
        window.setTimeout(function () { trySlideCaptcha(settings); }, 150);
      }).observe(image, { attributes: true, attributeFilter: ["src"] });
    }
  }

  // ── Main ─────────────────────────────────────────────────────────

  function primeLoginAfterFill(settings) {
    if (!settings.autoLogin || !settings.autoFill || _loginPrimed) return;
    var loginBtn = findLoginButton();
    if (!loginBtn) return;
    _loginPrimed = true;
    window.setTimeout(function () {
      if (invokeLoginButton(loginBtn)) {
        addStatus("NJU Helper: 已填入密码，正在获取验证码…", "info");
      } else {
        _loginPrimed = false;
      }
    }, 250);
  }

  function run(settings) {
    var usernameInput = queryFirst(selectors.username);
    var passwordInput = queryFirst(selectors.password);
    var captchaInput  = queryFirst(selectors.captchaInput);
    var captchaImage  = queryFirst(selectors.captchaImage);

    if (settings.autoFill) {
      if (usernameInput && settings.studentId) {
        setNativeValue(usernameInput, settings.studentId);
      }
      if (passwordInput && settings.password) {
        setNativeValue(passwordInput, settings.password);
      }
    }

    if (settings.autoFill && usernameInput && passwordInput && settings.studentId && settings.password) {
      primeLoginAfterFill(settings);
    }

    if (settings.autoCaptcha && captchaImage && captchaInput) {
      watchCaptchaRefresh(captchaImage, captchaInput, settings);
      tryRecogniseCaptcha(captchaImage, captchaInput, settings);
    }
    watchSliderRefresh(settings);
    trySlideCaptcha(settings);

    if (!usernameInput || !passwordInput) {
      addStatus("NJU Helper: 未找到登录表单", "warning");
      return;
    }

    if (settings.autoFill && settings.autoCaptcha) {
      addStatus("NJU Helper: 已填充账号，识别验证码中…", "info");
    } else if (settings.autoFill) {
      addStatus("NJU Helper: 已填充账号密码，请手动输入验证码", "success");
    }
  }

  // ── Bootstrap ────────────────────────────────────────────────────

  function isHelperNode(node) {
    if (!node) return false;
    var element = node.nodeType === 1 ? node : node.parentElement;
    return Boolean(element && (element.matches(".nju-autologin-status") ||
      element.closest(".nju-autologin-status")));
  }

  function needsRun(records) {
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (isHelperNode(record.target)) continue;
      var nodes = [];
      for (var j = 0; j < record.addedNodes.length; j++) nodes.push(record.addedNodes[j]);
      for (var k = 0; k < record.removedNodes.length; k++) nodes.push(record.removedNodes[k]);
      if (!nodes.length || nodes.some(function (node) { return !isHelperNode(node); })) return true;
    }
    return false;
  }

  function scheduleRun(settings) {
    if (_runPending) return;
    _runPending = true;
    window.setTimeout(function () {
      _runPending = false;
      run(settings);
    }, 100);
  }

  function init() {
    chrome.storage.local.get(DEFAULT_SETTINGS, function (settings) {
      run(settings);

      var observer = new MutationObserver(function (records) {
        if (needsRun(records)) scheduleRun(settings);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
