const test = require('node:test');
const assert = require('node:assert');
const A = require('../annotations.js');

const L = [
  { type: 'CALL_WALL', price: 30000, label: 'CALL WALL 30,000' },
  { type: 'PUT_WALL', price: 29000, label: 'PUT WALL 29,000' },
];

test('each record carries exactly the 37 keys DeepCharts accepts', () => {
  // The platform rejects nothing and silently draws nothing, so a missing key
  // is an invisible bug rather than an error message.
  const [r] = A.records(L, 1786901771);
  assert.strictEqual(Object.keys(r).length, 37);
  for (const k of ['AnnType', 'SymbName', 'Y1', 'Y2', 'Y3', 'IsExtended',
                   'SourceTfInMs', 'TextMsg', 'LabelAlign', 'Ann1', 'Name']) {
    assert.ok(k in r, `missing key ${k}`);
  }
});

test('geometry matches the accepted shape', () => {
  const [r] = A.records(L, 1786901771);
  assert.strictEqual(r.AnnType, 8, '8 is a horizontal line');
  assert.strictEqual(r.SymbName, 'NQ-CME');
  assert.strictEqual(r.SourceTfInMs, 300000);
  assert.strictEqual(r.IsExtended, true);
  assert.strictEqual(r.Y1, 30000);
  assert.strictEqual(r.Y2, 30000);
  assert.strictEqual(r.Y3, 30000.25, 'Y3 is Y1 plus one tick');
  assert.strictEqual(r.LabelAlign, 0, 'left gutter, so labels do not collide with MenthorQ');
});

test('the timestamp is epoch SECONDS in all three X slots', () => {
  // Milliseconds here put the anchor tens of thousands of years out. The line
  // still draws because IsExtended spans the chart, so nothing looks wrong.
  const [r] = A.records(L, 1786901771);
  for (const k of ['X1SizeValue', 'X2SizeValue', 'X3SizeValue']) {
    assert.strictEqual(r[k], 1786901771);
    assert.strictEqual(String(r[k]).length, 10, `${k} must be seconds, not milliseconds`);
  }
});

test('a fractional timestamp is floored to a whole second', () => {
  const [r] = A.records(L, 1786901771.87);
  assert.strictEqual(r.X1SizeValue, 1786901771);
});

test('names are unique so two levels cannot collapse into one', () => {
  const many = [...L, { type: 'CALL_WALL', price: 31000, label: 'x' }];
  const names = A.records(many, 1).map((r) => r.Name);
  assert.strictEqual(new Set(names).size, names.length);
});

test('call side and put side get different colours', () => {
  const [call, put] = A.records(L, 1);
  assert.notStrictEqual(call.Ann1.Style.Color, put.Ann1.Style.Color);
  for (const r of [call, put]) {
    assert.match(r.Ann1.Style.Color, /^#[0-9A-F]{8}$/, 'colour must be #AARRGGBB');
    assert.strictEqual(r.TextColor, r.Ann1.Style.Color, 'label matches its line');
  }
});

test('every styled type produces a visible line', () => {
  // A width of 0 or a fully transparent colour is drawn as nothing at all.
  for (const type of Object.keys(A.STYLE)) {
    const [r] = A.records([{ type, price: 100, label: 't' }], 1);
    assert.ok(r.Ann1.Style.LineWidth >= 1, `${type} has no width`);
    assert.notStrictEqual(r.Ann1.Style.Color.slice(0, 3), '#00', `${type} is transparent`);
  }
});

test('an unknown level type still renders rather than vanishing', () => {
  const [r] = A.records([{ type: 'MYSTERY', price: 1, label: 'x' }], 1);
  assert.ok(r.Ann1.Style.LineWidth >= 1);
  assert.strictEqual(r.TextMsg, 'x');
});

test('prices are rounded to two decimals, not left as float noise', () => {
  const [r] = A.records([{ type: 'PDH', price: 30000.123456, label: 'x' }], 1);
  assert.strictEqual(r.Y1, 30000.12);
  assert.strictEqual(r.Y3, 30000.37);
});

test('serialize writes CRLF - DeepCharts files use Windows line endings', () => {
  const text = A.serialize(A.records(L, 1));
  assert.ok(text.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(text), 'every LF must be preceded by CR');
  assert.strictEqual(JSON.parse(text).length, 2, 'still valid JSON');
});

test('serialize emits no BOM', () => {
  // A BOM ahead of the opening bracket makes the file unparseable to a strict
  // JSON reader, and DeepCharts would simply draw nothing.
  const text = A.serialize(A.records(L, 1));
  assert.strictEqual(text.charCodeAt(0), '['.charCodeAt(0));
});
