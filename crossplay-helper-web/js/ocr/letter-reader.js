/**
 * Letter recognition via template matching.
 * Port of crossplay_helper/ocr/letter_reader.py
 *
 * Templates are 32x32 grayscale PNGs loaded from /templates/.
 * Letter isolation: HSV threshold white letter, remove superscript (top-right),
 * remove edge bleed, center on 32x32 canvas.
 */

/* global cv */

const TEMPLATE_SIZE = 32;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CONFIDENCE_THRESHOLD = 0.6;

// Cache loaded templates
let templates = null;

/**
 * Load all letter templates.
 * @param {string} templateDir - URL path to template directory (no trailing slash)
 * @returns {Promise<Map<string, cv.Mat>>}
 */
export async function loadTemplates(templateDir) {
  if (templates) return templates;

  templates = new Map();
  const promises = ALPHABET.split('').map(async (letter) => {
    const url = `${templateDir}/${letter}.png`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(blob);

      // Draw to offscreen canvas to get pixel data
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

      // Create cv.Mat from ImageData (RGBA)
      const src = cv.matFromImageData(imgData);
      const gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      // Resize to template size if needed
      if (gray.rows !== TEMPLATE_SIZE || gray.cols !== TEMPLATE_SIZE) {
        const resized = new cv.Mat();
        cv.resize(gray, resized, new cv.Size(TEMPLATE_SIZE, TEMPLATE_SIZE));
        gray.delete();
        src.delete();
        templates.set(letter, resized);
      } else {
        src.delete();
        templates.set(letter, gray);
      }
    } catch (e) {
      // Template not found — skip
    }
  });

  await Promise.all(promises);
  return templates;
}

/**
 * Isolate the white letter from a blue tile cell image.
 * Removes the superscript point value (top-right corner) and edge bleed.
 *
 * @param {cv.Mat} cellGray - grayscale cell image
 * @returns {cv.Mat} 32x32 isolated letter Mat (caller must .delete())
 */
function isolateLetter(cellGray) {
  // Threshold white pixels
  const binary = new cv.Mat();
  cv.threshold(cellGray, binary, 180, 255, cv.THRESH_BINARY);

  // Blank out top-right corner (superscript point value) — roughly top 20%, right 30%
  const maskH = Math.round(binary.rows * 0.25);
  const maskW = Math.round(binary.cols * 0.35);
  const maskX = binary.cols - maskW;
  if (maskH > 0 && maskW > 0) {
    const roi = binary.roi(new cv.Rect(maskX, 0, maskW, maskH));
    roi.setTo(new cv.Scalar(0));
    roi.delete();
  }

  // Blank out edges (bleed from adjacent tiles) — 8% border
  const borderH = Math.round(binary.rows * 0.08);
  const borderW = Math.round(binary.cols * 0.08);
  if (borderH > 0 && borderW > 0) {
    // Top
    const top = binary.roi(new cv.Rect(0, 0, binary.cols, borderH));
    top.setTo(new cv.Scalar(0)); top.delete();
    // Bottom
    const bot = binary.roi(new cv.Rect(0, binary.rows - borderH, binary.cols, borderH));
    bot.setTo(new cv.Scalar(0)); bot.delete();
    // Left
    const left = binary.roi(new cv.Rect(0, 0, borderW, binary.rows));
    left.setTo(new cv.Scalar(0)); left.delete();
    // Right
    const right = binary.roi(new cv.Rect(binary.cols - borderW, 0, borderW, binary.rows));
    right.setTo(new cv.Scalar(0)); right.delete();
  }

  // Morphological open to remove noise
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
  const opened = new cv.Mat();
  cv.morphologyEx(binary, opened, cv.MORPH_OPEN, kernel);
  kernel.delete(); binary.delete();

  // Resize to 32x32
  const resized = new cv.Mat();
  cv.resize(opened, resized, new cv.Size(TEMPLATE_SIZE, TEMPLATE_SIZE));
  opened.delete();

  return resized;
}

/**
 * Read a letter from a tile cell.
 *
 * @param {cv.Mat} img - full BGR image
 * @param {{ x:number, y:number, w:number, h:number }} box - cell bounding box
 * @param {Map<string, cv.Mat>} tmplMap
 * @returns {{ letter:string, confidence:number }}
 */
export function readLetter(img, box, tmplMap) {
  if (tmplMap.size === 0) return { letter: '?', confidence: 0 };

  const roi = img.roi(new cv.Rect(box.x, box.y, box.w, box.h));
  const gray = new cv.Mat();
  try {
    cv.cvtColor(roi, gray, cv.COLOR_BGR2GRAY);
    const isolated = isolateLetter(gray);
    try {
      let bestLetter = '?';
      let bestScore = -Infinity;

      for (const [letter, tmpl] of tmplMap) {
        const result = new cv.Mat();
        try {
          cv.matchTemplate(isolated, tmpl, result, cv.TM_CCOEFF_NORMED);
          const minMax = cv.minMaxLoc(result);
          if (minMax.maxVal > bestScore) {
            bestScore = minMax.maxVal;
            bestLetter = letter;
          }
        } finally {
          result.delete();
        }
      }

      return { letter: bestLetter, confidence: bestScore };
    } finally {
      isolated.delete();
    }
  } finally {
    roi.delete(); gray.delete();
  }
}

/**
 * Read a rack tile (larger than board cells).
 * Resizes rack tile to ~board cell size before matching.
 *
 * @param {cv.Mat} img
 * @param {{ x:number, y:number, w:number, h:number }} box
 * @param {Map<string, cv.Mat>} tmplMap
 * @param {number} targetSize - board cell pixel size (approx 80)
 * @returns {{ letter:string, confidence:number }}
 */
export function readRackTile(img, box, tmplMap, targetSize = 80) {
  const roi = img.roi(new cv.Rect(box.x, box.y, box.w, box.h));
  const resized = new cv.Mat();
  try {
    cv.resize(roi, resized, new cv.Size(targetSize, targetSize));
    const gray = new cv.Mat();
    try {
      cv.cvtColor(resized, gray, cv.COLOR_BGR2GRAY);
      const isolated = isolateLetter(gray);
      try {
        let bestLetter = '?';
        let bestScore = -Infinity;
        for (const [letter, tmpl] of tmplMap) {
          const result = new cv.Mat();
          try {
            cv.matchTemplate(isolated, tmpl, result, cv.TM_CCOEFF_NORMED);
            const minMax = cv.minMaxLoc(result);
            if (minMax.maxVal > bestScore) {
              bestScore = minMax.maxVal;
              bestLetter = letter;
            }
          } finally {
            result.delete();
          }
        }
        return { letter: bestLetter, confidence: bestScore };
      } finally {
        isolated.delete();
      }
    } finally {
      gray.delete();
    }
  } finally {
    roi.delete(); resized.delete();
  }
}

export { CONFIDENCE_THRESHOLD };
