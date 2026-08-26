import * as ort from "onnxruntime-web/all";

// Standard OCR model and charset shipped by ddddocr-node.
var MODEL_NAME = "common_old.onnx";
var CHARSET_NAME = "common_old.json";
var VALID_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
var _session = null, _charset = null, _ready = false, _initPromise = null;

export function init(modelRoot) {
  if (_ready) return Promise.resolve();
  if (_initPromise) return _initPromise;
  _initPromise = _doInit(modelRoot).catch(function (err) {
    // A transient WASM/model load failure must not poison this tab forever.
    _session = null;
    _charset = null;
    _ready = false;
    _initPromise = null;
    throw err;
  });
  return _initPromise;
}

async function _doInit(modelRoot) {
  var root = modelRoot.endsWith("/") ? modelRoot : modelRoot + "/";
  ort.env.wasm.wasmPaths = chrome.runtime.getURL("dist/");
  var response = await fetch(root + MODEL_NAME);
  if (!response.ok) throw new Error("Fetch model " + response.status);
  var modelData = await response.arrayBuffer();
  var charsetResponse = await fetch(root + CHARSET_NAME);
  if (!charsetResponse.ok) throw new Error("Fetch charset " + charsetResponse.status);
  _charset = await charsetResponse.json();
  _session = await ort.InferenceSession.create(modelData, {
    executionProviders: ["webgl", "wasm"]
  });
  _ready = true;
}

export function isReady() { return _ready; }

export function whenReady() {
  return _initPromise || Promise.reject(new Error("init never called"));
}

async function imageToTensor(imgEl) {
  if (!imgEl.complete || imgEl.naturalWidth === 0) {
    await new Promise(function (resolve, reject) {
      var done = false;
      var finish = function (callback, value) {
        if (done) return;
        done = true;
        callback(value);
      };
      var onLoad = function () { finish(resolve, imgEl); };
      var onError = function (err) { finish(reject, err); };
      imgEl.addEventListener("load", onLoad, { once: true });
      imgEl.addEventListener("error", onError, { once: true });
      // The image may have completed between the initial check and listener
      // registration.
      if (imgEl.complete) {
        if (imgEl.naturalWidth > 0) onLoad();
        else onError(new Error("captcha image failed to load"));
      }
    });
  }
  if (!imgEl.naturalWidth || !imgEl.naturalHeight) {
    throw new Error("captcha image has no dimensions");
  }
  var targetHeight = 64;
  var targetWidth = Math.max(1, Math.floor(imgEl.naturalWidth * targetHeight / imgEl.naturalHeight));
  var canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  var ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imgEl, 0, 0, targetWidth, targetHeight);
  var pixels = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
  var data = new Float32Array(targetWidth * targetHeight);
  for (var i = 0; i < data.length; i++) {
    var p = i * 4;
    var gray = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
    data[i] = (gray / 255 - 0.5) / 0.5;
  }
  return new ort.Tensor("float32", data, [1, 1, targetHeight, targetWidth]);
}

function decode(output) {
  if (!output || !output.dims || !output.dims.length || !output.data) {
    throw new Error("OCR output is empty");
  }
  var classCount = output.dims[output.dims.length - 1];
  if (!Number.isFinite(classCount) || classCount <= 0 || output.data.length % classCount !== 0) {
    throw new Error("OCR output shape is invalid");
  }
  var timeSteps = output.data.length / classCount;
  var result = [];
  var last = 0;
  for (var t = 0; t < timeSteps; t++) {
    var base = t * classCount;
    var best = 0, bestValue = -Infinity;
    for (var c = 0; c < classCount; c++) {
      if (output.data[base + c] > bestValue) {
        bestValue = output.data[base + c];
        best = c;
      }
    }
    if (best !== last) {
      var ch = _charset[best];
      if (best !== 0 && ch && VALID_CHARS.indexOf(ch) >= 0) result.push(ch);
    }
    last = best;
  }
  return result.join("");
}

export async function recognise(imgEl) {
  if (!_ready || !_session) throw new Error("Model not loaded");
  var tensor = await imageToTensor(imgEl);
  var results = await _session.run({ input1: tensor });
  var output = results["387"] || results[Object.keys(results)[0]];
  if (!output) throw new Error("OCR output node is missing");
  var text = decode(output);
  return { text: text, chars: text.split("") };
}
