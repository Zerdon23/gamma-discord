/*
 * levels/latest.json -> a complete TradingView indicator.
 *
 * Two halves, built differently on purpose:
 *
 *   Goldbach is emitted as ARITHMETIC. floor(price / PO3) * PO3 is evaluated on
 *   the viewer's chart, so the grid re-derives itself as price moves into a new
 *   block. An old copy of this file still draws a correct grid.
 *
 *   Gamma is emitted as CONSTANTS, because Pine cannot fetch anything. The
 *   walls are open-interest based and rebuild overnight, so today's numbers are
 *   right for one session and wrong after that. Hence the build stamp.
 *
 * The prices in latest.json are ALREADY NQ prices - build-levels.js applies the
 * NDX->NQ basis and refuses to publish when that basis is stale. Nothing here
 * adjusts them. A test pins that.
 *
 * ASCII only. A non-ASCII character survives here and gets mangled the moment
 * the file passes through a chat client, which is how a script that "looks
 * fine" fails to compile on someone else's screen.
 */
const G = require('./goldbach.js');

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

function build(meta) {
  if (!meta || !meta.builtAt) {
    throw new Error('pine.build: no builtAt - refusing to emit an undated script');
  }
  if (!meta.levels || meta.levels.length === 0) {
    throw new Error('pine.build: no levels to write');
  }

  const day = String(meta.builtAt).slice(0, 10);
  const symbol = ascii(meta.symbol || 'NQ');
  const gam = meta.levels;

  const fracs = G.TABLE.map((t) => t.frac.toFixed(3)).join(', ');
  const codes = G.TABLE.map((t) => q(t.code)).join(', ');
  const cols = G.TABLE.map((t) => rgb(G.COLORS[t.grp])).join(', ');
  const names = G.TABLE.map((t) => q(G.fracLabel(t.frac))).join(', ');
  // The extremes and equilibrium are the structure; the interior arrays are
  // detail. Drawing all seventeen identically is what makes a grid read as noise.
  const widths = G.TABLE.map((t) => (t.grp === 'Ext' || t.grp === 'Eq' ? 2 : 1)).join(', ');
  const dashes = G.TABLE.map((t) => (t.grp === 'Ext' || t.grp === 'Eq' ? 'false' : 'true')).join(', ');

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

  return `//@version=6
// =====================================================================
//  Goldbach + Gamma - ${symbol}
//  Gamma levels built ${day} from CBOE's free delayed _NDX chain.
//
//  The Goldbach grid is arithmetic and never goes stale - it re-derives
//  itself from whatever price is on your chart.
//
//  The gamma levels are this morning's numbers written in. They come from
//  open interest, which rebuilds overnight, so they are right for one
//  session. Grab the new file each morning.
//
//  Context and targets, not triggers.
// =====================================================================
indicator("Goldbach + Gamma - ${symbol}", overlay = true, max_lines_count = 500, max_labels_count = 500, max_boxes_count = 20)

gbxGroup = "Goldbach"
showGb  = input.bool(true,  "Show the Goldbach grid",        group = gbxGroup)
po3Mode = input.string("Auto", "Range size", options = ["Auto", "27", "81", "243", "729", "2187", "6561"], group = gbxGroup)
shiftBl = input.int(0, "Shift the range (blocks)", minval = -3, maxval = 3, group = gbxGroup)
showExt = input.bool(true,  "Extensions (-0.111 / 1.111)",   group = gbxGroup)
showCE  = input.bool(true,  "CE midpoints",                  group = gbxGroup)
showSh  = input.bool(true,  "Shade premium / discount",      group = gbxGroup)
showLb  = input.bool(true,  "Labels",                        group = gbxGroup)

gbxGamma = "Gamma (built ${day})"
showGx  = input.bool(true,  "Show today's gamma levels",     group = gbxGamma)
showTag = input.bool(true,  "Show the build date on screen", group = gbxGamma)

fracs  = array.from(${fracs})
codes  = array.from(${codes})
fnames = array.from(${names})
fcols  = array.from(${cols})
fwidth = array.from(${widths})
fdash  = array.from(${dashes})

gPrice = array.from(${gPrices})
gText  = array.from(${gLabels})
gCol   = array.from(${gCols})
gWid   = array.from(${gWidths})
gSty   = array.from(${gStyles})

// These prices are ${symbol} prices. On any other symbol they are meaningless,
// so the gamma half hides itself rather than drawing confident nonsense.
isRight = str.contains(syminfo.ticker, "${symbol}")

autoBlock(p) =>
    best  = 729.0
    bestd = 1e9
    for s in array.from(27.0, 81.0, 243.0, 729.0, 2187.0, 6561.0)
        d = math.abs(s / p - 0.03)
        if d < bestd
            bestd := d
            best  := s
    best

gbxPo3 = po3Mode == "Auto" ? autoBlock(close) : str.tonumber(po3Mode)
gbxLo  = math.floor(close / gbxPo3) * gbxPo3 + shiftBl * gbxPo3
gbxHi  = gbxLo + gbxPo3
gbxEq  = gbxLo + gbxPo3 * 0.5

var line[]  LN = array.new<line>()
var label[] LB = array.new<label>()
var box[]   BX = array.new<box>()
var table   TG = table.new(position.bottom_right, 1, 1)

if barstate.islast
    // pop-until-empty, NOT "for i = 0 to size - 1". Pine counts DOWNWARD when
    // the end is below the start, so on an empty array that loop runs with
    // i = 0 and then i = -1 and throws.
    while array.size(LN) > 0
        line.delete(array.pop(LN))
    while array.size(LB) > 0
        label.delete(array.pop(LB))
    while array.size(BX) > 0
        box.delete(array.pop(BX))

    // Clamped at 0: a freshly loaded or very short chart has fewer than 300
    // bars, and a negative bar index is an error rather than a wide line.
    // extend.both means these endpoints only decide where labels sit anyway.
    L = math.max(0, bar_index - 300)
    R = bar_index + 30

    if showGb and showSh
        array.push(BX, box.new(L, gbxHi, R, gbxEq, border_color = color.new(color.red, 100), bgcolor = color.rgb(224, 90, 90, 96)))
        array.push(BX, box.new(L, gbxEq, R, gbxLo, border_color = color.new(color.green, 100), bgcolor = color.rgb(90, 200, 140, 96)))

    float prev = na
    if showGb
        for i = 0 to array.size(fracs) - 1
            f = array.get(fracs, i)
            // A wrapping condition rather than "continue" - the CE midpoint has
            // to be measured between DRAWN levels, so a skipped extension must
            // also be skipped by prev.
            if (f >= 0 and f <= 1) or showExt
                p = gbxLo + (gbxHi - gbxLo) * f
                c = array.get(fcols, i)
                array.push(LN, line.new(L, p, R, p, extend = extend.both, color = c, width = array.get(fwidth, i), style = array.get(fdash, i) ? line.style_dashed : line.style_solid))
                if showLb
                    t = array.get(fnames, i) + "  " + array.get(codes, i) + "  " + str.tostring(p, "#,##0.00")
                    array.push(LB, label.new(R, p, t, style = label.style_label_left, textcolor = c, color = color.new(color.black, 80), size = size.small))
                if showCE and not na(prev)
                    m = (prev + p) / 2
                    array.push(LN, line.new(L, m, R, m, extend = extend.both, color = color.rgb(120, 130, 145, 40), width = 1, style = line.style_dotted))
                prev := p

    if showGx and isRight
        for i = 0 to array.size(gPrice) - 1
            p = array.get(gPrice, i)
            c = array.get(gCol, i)
            array.push(LN, line.new(L, p, R, p, extend = extend.both, color = c, width = array.get(gWid, i), style = array.get(gSty, i)))
            if showLb
                array.push(LB, label.new(R, p, array.get(gText, i), style = label.style_label_left, textcolor = c, color = color.new(color.black, 80), size = size.small))

    if showGx and not isRight
        array.push(LB, label.new(bar_index, close, "Gamma levels are ${symbol} prices - hidden on this symbol. The Goldbach grid still applies.", style = label.style_label_left, textcolor = color.rgb(232, 176, 72), color = color.new(color.black, 70), size = size.small))

    if showTag
        table.cell(TG, 0, 0, "Goldbach + Gamma   gamma built ${day}   walls rebuild overnight", text_color = color.rgb(170, 180, 195), bgcolor = color.new(color.black, 70), text_size = size.tiny)
`;
}

module.exports = { build, ascii, GAMMA_STYLE };
