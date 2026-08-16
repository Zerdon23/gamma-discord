/*
 * Levels -> DeepCharts annotation JSON.
 *
 * Every field is copied from a record DeepCharts has already accepted
 * (Documents\Deepchart\Workspace\MenthorQ_NQ.xml, read 2026-08-16). Do not tidy
 * fields away: the platform rejects nothing and silently draws nothing, so an
 * omitted key is an invisible bug rather than an error.
 *
 * The file carries a .xml extension and contains JSON. That is the platform's
 * choice, not a mistake, and renaming it breaks the import.
 */
const SYMBOL = 'NQ-CME';
const TF_MS = 300000;      // 5-minute bars
const TICK = 0.25;         // NQ tick; Y3 sits one tick above the line

const CALL = '#FFC46A6A';      // red - resistance above
const PUT = '#FF6ABF8A';       // green - support below
const FLIP = '#FFE8D44D';      // yellow - the pivot between the two regimes
const GAMMA_P = '#FF7FB6D9';   // ice - positive gamma shelf
const GAMMA_N = '#FFC08AD0';   // violet - negative gamma shelf
const SESSION = '#FFBFC7D5';   // grey - prior day / overnight, deliberately quiet

// type -> [line width, colour, LStyle: 0 solid / 1 dashed / 2 dotted]
//
// Weight carries meaning: the walls and the flip are the structure, the shelves
// are supporting detail, and the session levels are reference. Drawing all nine
// identically is what makes a chart read as one wall of noise.
const STYLE = {
  CALL_WALL: [3, CALL, 0],
  PUT_WALL: [3, PUT, 0],
  FLIP: [3, FLIP, 1],
  GAMMA_POS: [2, GAMMA_P, 0],
  GAMMA_NEG: [2, GAMMA_N, 0],
  PDH: [1, SESSION, 2],
  PDL: [1, SESSION, 2],
  ONH: [1, SESSION, 2],
  ONL: [1, SESSION, 2],
};
const DEFAULT_STYLE = [2, '#FFF2F2F2', 0];

const round2 = (n) => Math.round(Number(n) * 100) / 100;

function records(levels, tsSec) {
  // Epoch SECONDS. Milliseconds here anchor the line tens of thousands of years
  // out; because IsExtended spans the chart anyway, nothing would look wrong.
  const ts = Math.floor(tsSec);

  return (levels || []).map((lv, i) => {
    const [width, colour, lstyle] = STYLE[lv.type] || DEFAULT_STYLE;
    const price = round2(lv.price);
    return {
      AnnType: 8, alert: null, SymbName: SYMBOL,
      // Index-prefixed so two levels at the same price cannot share a name.
      Name: `DCL_${i}_${lv.type}`,
      FontSize: 11, CAIndex: 0,
      X1SizeUnit: 0, X1SizeValue: ts, DTX1: '0001-01-01T00:00:00',
      X2SizeUnit: 0, X2SizeValue: ts, DTX2: '0001-01-01T00:00:00',
      X3SizeUnit: 0, X3SizeValue: ts, DTX3: '0001-01-01T00:00:00',
      Y1: price, Y2: price, Y3: round2(price + TICK),
      FreehandPoints: null, SlopeY2: 0, SlopeY3: 0,
      SourceTfInMs: TF_MS, IsExtended: true, IsLocked: false,
      Ann1: {
        Hidden: false,
        Style: { Color: colour, LineWidth: width, LStyle: lstyle },
        Background: { Color: '#33F2F2F2', Opacity: 20 },
      },
      Ann2: null,
      TextMsg: lv.label,
      TextPadding: 0, TextColor: colour,
      ShowDifference: false, ShowPercent: false, ShowPrice: true,
      ShowLblBackground: true,
      IsExchDT: true,
      // 0 = left. Everything else on a typical chart (MenthorQ, session levels)
      // aligns right, so every label competes for one gutter; taking the empty
      // left one is what stops these colliding with what is already there.
      LabelAlign: 0,
      AnnParam: null, Money: null,
    };
  });
}

// CRLF throughout, no BOM - matching the files the platform already reads.
const serialize = (recs) => JSON.stringify(recs, null, 2).replace(/\n/g, '\r\n');

module.exports = { records, serialize, STYLE };
