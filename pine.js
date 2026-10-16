/*
 * levels/latest.json + the private AQQ fragments -> one TradingView indicator.
 *
 * Three parts, built differently on purpose:
 *
 *   Gamma is emitted as CONSTANTS, because Pine cannot fetch anything. The
 *   walls are open-interest based and rebuild overnight, so today's numbers are
 *   right for one session and wrong after that. Hence the build stamp.
 *
 *   AQQ Levels and AQQ SMT are spliced in VERBATIM from Brandon's own scripts
 *   (fragments written by aqq-friends-pine/extract.js). Both work everything out
 *   from the chart, so an old copy still draws them correctly. They are his paid
 *   mentorship code, so they live in a PRIVATE repo and are never committed here
 *   - this repo is public.
 *
 * The Goldbach grid this script used to carry was removed 2026-10-12 at his ask.
 *
 * The prices in latest.json are ALREADY NQ prices - build-levels.js applies the
 * NDX->NQ basis and refuses to publish when that basis is stale. Nothing here
 * adjusts them. A test pins that.
 *
 * ASCII only in what THIS file writes. The fragments are his scripts verbatim,
 * and the one non-ASCII character they carry is the star the AQQ engine draws
 * on its best taps. That is safe because the file reaches people as a Discord
 * ATTACHMENT, which is byte-exact, never as pasted chat text.
 */

// One name, used by the builder, the crew post and the attachment.
const FILE = 'AQQ-Gamma-NQ';

// Gamma colours copied from annotations.js so a friend's TradingView chart and
// Brandon's DeepCharts chart are the same picture.
const GAMMA_STYLE = {
  CALL_WALL: { rgb: [196, 106, 106], width: 3, style: 'solid' },
  PUT_WALL: { rgb: [106, 191, 138], width: 3, style: 'solid' },
  FLIP: { rgb: [232, 212, 77], width: 3, style: 'dashed' },
  GAMMA_POS: { rgb: [127, 182, 217], width: 2, style: 'solid' },
  GAMMA_NEG: { rgb: [192, 138, 208], width: 2, style: 'solid' },
  PDH: { rgb: [191, 199, 213], width: 1, style: 'dotted' },
  PDL: { rgb: [191, 199, 213], width: 1, style: 'dotted' },
  ONH: { rgb: [191, 199, 213], width: 1, style: 'dotted' },
  ONL: { rgb: [191, 199, 213], width: 1, style: 'dotted' },
};
const DEFAULT_GAMMA = { rgb: [242, 242, 242], width: 2, style: 'solid' };

const LINE_STYLE = {
  solid: 'line.style_solid',
  dashed: 'line.style_dashed',
  dotted: 'line.style_dotted',
};

/*
 * The label text the pipeline writes really does contain U+00B7 ("+GAMMA
 * 30,000 - 503m"). Transliterate the punctuation people actually use before
 * stripping - deleting the dot outright leaves "30,000  503m", a double space
 * that reads as a bug rather than as a separator.
 */
function ascii(s) {
  return String(s)
    .replace(/[·•]/g, '-')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7e]/g, '');
}

/** Quote for Pine. Inner double quotes become single - Pine has no escape here. */
const q = (s) => `"${ascii(s).replace(/"/g, "'")}"`;

const rgb = (c) => `color.rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/**
 * @param meta  levels/latest.json
 * @param frag  { smt, levels } - Pine text from aqq-friends-pine. Required: a
 *              script without them would post a gamma-only file under the AQQ
 *              name, which is worse than posting nothing.
 */
function build(meta, frag) {
  if (!meta || !meta.builtAt) {
    throw new Error('pine.build: no builtAt - refusing to emit an undated script');
  }
  if (!meta.levels || meta.levels.length === 0) {
    throw new Error('pine.build: no levels to write');
  }
  if (!frag || !frag.smt || !frag.levels) {
    throw new Error('pine.build: no AQQ fragments - refusing to emit a gamma-only script');
  }

  const day = String(meta.builtAt).slice(0, 10);
  const symbol = ascii(meta.symbol || 'NQ');
  const gam = meta.levels;

  const st = (l) => GAMMA_STYLE[l.type] || DEFAULT_GAMMA;
  /*
   * Every price gets a decimal point, always.
   *
   * Pine infers an array's element type from its FIRST element, so
   * array.from(29900, 29300, 29450.76, ...) declares an array<int> and then
   * hands it a float. A wall usually lands on a whole number while the gamma
   * flip almost never does, so the first element is nearly always the integer
   * that poisons the rest. toFixed(2) makes the literal unambiguously float.
   */
  const gPrices = gam.map((l) => Number(l.price).toFixed(2)).join(', ');
  const gLabels = gam.map((l) => q(l.label)).join(', ');
  const gCols = gam.map((l) => rgb(st(l).rgb)).join(', ');
  const gWidths = gam.map((l) => st(l).width).join(', ');
  const gStyles = gam.map((l) => LINE_STYLE[st(l).style]).join(', ');

  // Every name in the gamma block starts gx/g so it cannot collide with a name
  // in his scripts - Pine reports a duplicate as CE10095 and names only the first.
  return `//@version=6
// =====================================================================
//  AQQ + Gamma - ${symbol}
//  Gamma levels built ${day} from CBOE's free delayed _NDX chain.
//
//  AQQ Levels and SMT are worked out from your chart, so they never go
//  stale. The gamma levels are this morning's numbers written in. They
//  come from open interest, which rebuilds overnight, so they are right
//  for one session. Grab the new file each morning.
//
//  Context and targets, not triggers.
// =====================================================================
indicator("AQQ + Gamma - ${symbol}", shorttitle = "AQQ + Gamma", overlay = true, max_lines_count = 500, max_labels_count = 500, max_boxes_count = 500, max_bars_back = 1000)

gxGroup = "Gamma (built ${day})"
gxShow  = input.bool(true, "Show today's gamma levels",     group = gxGroup)
gxLbl   = input.bool(true, "Labels",                        group = gxGroup)
gxTagOn = input.bool(true, "Show the build date on screen", group = gxGroup)

gPrice = array.from(${gPrices})
gText  = array.from(${gLabels})
gCol   = array.from(${gCols})
gWid   = array.from(${gWidths})
gSty   = array.from(${gStyles})

// These prices are ${symbol} prices. On any other symbol they are meaningless,
// so the gamma lines hide themselves rather than drawing confident nonsense.
gxRight = str.contains(syminfo.ticker, "${symbol}")

var line[]  gxLN = array.new<line>()
var label[] gxLB = array.new<label>()
var table   gxTG = table.new(position.top_center, 1, 1)

if barstate.islast
    // pop-until-empty, NOT "for i = 0 to size - 1". Pine counts DOWNWARD when
    // the end is below the start, so on an empty array that loop runs with
    // i = 0 and then i = -1 and throws.
    while array.size(gxLN) > 0
        line.delete(array.pop(gxLN))
    while array.size(gxLB) > 0
        label.delete(array.pop(gxLB))

    // Clamped at 0: a freshly loaded chart can have fewer than 300 bars, and a
    // negative bar index is an error rather than a wide line.
    gxL = math.max(0, bar_index - 300)
    gxR = bar_index + 30

    if gxShow and gxRight
        for i = 0 to array.size(gPrice) - 1
            p = array.get(gPrice, i)
            c = array.get(gCol, i)
            array.push(gxLN, line.new(gxL, p, gxR, p, extend = extend.both, color = c, width = array.get(gWid, i), style = array.get(gSty, i)))
            if gxLbl
                array.push(gxLB, label.new(gxR, p, array.get(gText, i), style = label.style_label_left, textcolor = c, color = color.new(color.black, 80), size = size.small))

    if gxShow and not gxRight
        array.push(gxLB, label.new(bar_index, close, "Gamma levels are ${symbol} prices - hidden on this symbol. AQQ Levels and SMT still apply.", style = label.style_label_left, textcolor = color.rgb(232, 176, 72), color = color.new(color.black, 70), size = size.small))

    if gxTagOn
        table.cell(gxTG, 0, 0, "AQQ + Gamma   gamma built ${day}   walls rebuild overnight", text_color = color.rgb(170, 180, 195), bgcolor = color.new(color.black, 70), text_size = size.tiny)

// =====================================================================
//  AQQ SMT
// =====================================================================
${frag.smt}

// =====================================================================
//  AQQ LEVELS (worked out from the chart)
// =====================================================================
${frag.levels}
`;
}

module.exports = { build, ascii, GAMMA_STYLE, FILE };
