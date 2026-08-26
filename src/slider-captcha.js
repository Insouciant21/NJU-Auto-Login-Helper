import { bitmapToGray, canny, matchTemplateCcoeffNormed } from "../node_modules/ddddocr-node/dist/browser/utils/cv-utils.js";

function waitForImage(image) {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve(image);
  return new Promise(function (resolve, reject) {
    var done = false;
    var finish = function (callback, value) {
      if (done) return;
      done = true;
      callback(value);
    };
    var onLoad = function () { finish(resolve, image); };
    var onError = function (err) { finish(reject, err); };
    image.addEventListener("load", onLoad, { once: true });
    image.addEventListener("error", onError, { once: true });
    // The image can finish loading between the initial check and listener
    // registration.
    if (image.complete) {
      if (image.naturalWidth > 0) onLoad();
      else onError(new Error("slider image failed to load"));
    }
  });
}

async function readBitmap(image) {
  await waitForImage(image);
  var canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  var context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  var pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  var alpha = pixels.data;
  var minX = canvas.width;
  var minY = canvas.height;
  var maxX = -1;
  var maxY = -1;
  for (var y = 0; y < canvas.height; y++) {
    for (var x = 0; x < canvas.width; x++) {
      if (alpha[(y * canvas.width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    gray: bitmapToGray({ width: canvas.width, height: canvas.height, data: pixels.data }),
    alphaBox: maxX >= 0 ? { minX: minX, minY: minY, maxX: maxX, maxY: maxY } : null
  };
}

function cropGray(gray, box) {
  var width = box.maxX - box.minX + 1;
  var height = box.maxY - box.minY + 1;
  var data = new Uint8Array(width * height);
  for (var y = 0; y < height; y++) {
    var sourceStart = (box.minY + y) * gray.width + box.minX;
    data.set(gray.data.subarray(sourceStart, sourceStart + width), y * width);
  }
  return { data: data, width: width, height: height };
}

// Same edge-template matching pipeline used by ddddocr-node's slideMatch.
export async function findSliderOffset(backgroundImage, pieceImage, renderedWidth) {
  if (!Number.isFinite(renderedWidth) || renderedWidth <= 0) {
    throw new Error("slider rendered width is invalid");
  }
  var background = await readBitmap(backgroundImage);
  var piece = await readBitmap(pieceImage);
  var source = canny(background.gray, 50, 150);
  var candidates = [{
    name: "full",
    template: canny(piece.gray, 50, 150),
    xAdjust: 0
  }];

  // The NJU piece is a tall transparent strip. Matching the transparent
  // padding makes the correlation score unstable, so also try the actual
  // alpha-bounded piece. Keep the full-image candidate as a fallback for
  // captchas that use an opaque target image.
  var box = piece.alphaBox;
  if (box && ((box.maxX - box.minX + 1) < piece.gray.width ||
      (box.maxY - box.minY + 1) < piece.gray.height)) {
    var padding = 1;
    var cropBox = {
      minX: Math.max(0, box.minX - padding),
      minY: Math.max(0, box.minY - padding),
      maxX: Math.min(piece.gray.width - 1, box.maxX + padding),
      maxY: Math.min(piece.gray.height - 1, box.maxY + padding)
    };
    candidates.push({
      name: "alpha-crop",
      template: canny(cropGray(piece.gray, cropBox), 50, 150),
      // The page draws the original transparent strip at block-left = 0;
      // convert the visible shape's match back to that strip's left edge.
      xAdjust: -cropBox.minX
    });
  }

  var match = null;
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    if (candidate.template.width < 3 || candidate.template.height < 3 ||
        candidate.template.width > source.width || candidate.template.height > source.height) {
      continue;
    }
    var current = matchTemplateCcoeffNormed(source, candidate.template);
    if (Number.isFinite(current.score) && (!match || current.score > match.score)) {
      match = {
        x: current.x + candidate.xAdjust,
        y: current.y,
        score: current.score,
        method: candidate.name,
        templateWidth: candidate.template.width,
        templateHeight: candidate.template.height
      };
    }
  }
  if (!match || !Number.isFinite(match.x) || !Number.isFinite(match.score)) {
    throw new Error("slider template match is invalid");
  }
  var scale = renderedWidth / background.gray.width;
  return {
    offset: Math.max(0, Math.min(renderedWidth - 2, Math.round(match.x * scale))),
    score: match.score,
    method: match.method,
    sourceWidth: background.gray.width,
    renderedWidth: renderedWidth,
    matchX: match.x,
    templateWidth: match.templateWidth,
    templateHeight: match.templateHeight
  };
}

function sleep(ms) {
  return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
}

export async function dragSlider(slider, offset) {
  if (!Number.isFinite(offset)) throw new Error("slider offset is invalid");
  var rect = slider.getBoundingClientRect();
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
      rect.width <= 0 || rect.height <= 0) {
    throw new Error("slider handle is not visible");
  }
  var startX = rect.left + rect.width / 2;
  var startY = rect.top + rect.height / 2;
  var mouseEvent = function (type, x, y) {
    var event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(x),
      clientY: Math.round(y),
      buttons: type === "mouseup" ? 0 : 1
    });
    // jQuery/native slider implementations commonly use `which` when
    // normalizing mouse input. MouseEvent's constructor does not expose it,
    // so define the left-button value explicitly where the browser allows it.
    try { Object.defineProperty(event, "which", { value: 1 }); } catch (_) {}
    return event;
  };

  slider.dispatchEvent(mouseEvent("mousedown", startX, startY));
  await sleep(55);
  var steps = 75;
  for (var i = 1; i <= steps; i++) {
    var progress = i / steps;
    var eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    var jitter = Math.sin(progress * 7) * 2;
    document.dispatchEvent(mouseEvent("mousemove", startX + offset * eased + Math.sin(progress * Math.PI) * 1.2, startY + jitter));
    await sleep(14 + (i % 4) * 3);
  }
  document.dispatchEvent(mouseEvent("mousemove", startX + offset + 1, startY));
  await sleep(70);
  document.dispatchEvent(mouseEvent("mouseup", startX + offset, startY));
}
