import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateTime, toNumber, toLocalIso, startOfWeek, dayKey } from '../src/core/dates.js';

// Wednesday 2026-05-13 10:00 local time.
const NOW = new Date(2026, 4, 13, 10, 0);
const at = (text) => {
  const { date, hasTime, rest } = parseDateTime(text, NOW);
  return [date ? toLocalIso(date) : null, hasTime, rest];
};

test('Chinese numerals', () => {
  assert.equal(toNumber('三'), 3);
  assert.equal(toNumber('十'), 10);
  assert.equal(toNumber('十二'), 12);
  assert.equal(toNumber('二十'), 20);
  assert.equal(toNumber('二十五'), 25);
  assert.equal(toNumber('两'), 2);
  assert.equal(toNumber('15'), 15);
  assert.ok(Number.isNaN(toNumber('abc')));
});

test('relative days in Chinese', () => {
  assert.deepEqual(at('今天交报告'), ['2026-05-13T00:00', false, '交报告']);
  assert.deepEqual(at('明天交报告'), ['2026-05-14T00:00', false, '交报告']);
  assert.deepEqual(at('后天开会'), ['2026-05-15T00:00', false, '开会']);
  assert.deepEqual(at('大后天体检'), ['2026-05-16T00:00', false, '体检']);
  assert.deepEqual(at('三天后复查'), ['2026-05-16T00:00', false, '复查']);
  assert.deepEqual(at('2周后交稿'), ['2026-05-27T00:00', false, '交稿']);
});

test('weekdays: bare means the next one, including today', () => {
  assert.deepEqual(at('周三例会'), ['2026-05-13T00:00', false, '例会']);
  assert.deepEqual(at('周五交周报'), ['2026-05-15T00:00', false, '交周报']);
  assert.deepEqual(at('周一站会'), ['2026-05-18T00:00', false, '站会']);
  assert.deepEqual(at('星期天爬山'), ['2026-05-17T00:00', false, '爬山']);
});

test('weekdays: 下周 and 本周 are calendar weeks starting Monday', () => {
  assert.deepEqual(at('下周一面试'), ['2026-05-18T00:00', false, '面试']);
  assert.deepEqual(at('下周五答辩'), ['2026-05-22T00:00', false, '答辩']);
  assert.deepEqual(at('下下周三复盘'), ['2026-05-27T00:00', false, '复盘']);
  assert.deepEqual(at('本周一的事'), ['2026-05-11T00:00', false, '的事']);
  assert.equal(dayKey(startOfWeek(NOW)), '2026-05-11');
});

test('calendar dates', () => {
  assert.deepEqual(at('5月20日交论文'), ['2026-05-20T00:00', false, '交论文']);
  assert.deepEqual(at('六月一号搬家'), ['2026-06-01T00:00', false, '搬家']);
  assert.deepEqual(at('3月1日报税'), ['2027-03-01T00:00', false, '报税']);
  assert.deepEqual(at('2026-12-31 年终总结'), ['2026-12-31T00:00', false, '年终总结']);
  assert.deepEqual(at('6/18 买礼物'), ['2026-06-18T00:00', false, '买礼物']);
  assert.deepEqual(at('20号发工资'), ['2026-05-20T00:00', false, '发工资']);
  assert.deepEqual(at('5号还信用卡'), ['2026-06-05T00:00', false, '还信用卡']);
  assert.deepEqual(at('月底盘点'), ['2026-05-31T00:00', false, '盘点']);
  assert.deepEqual(at('下个月3号体检'), ['2026-06-03T00:00', false, '体检']);
});

test('clock times with a period of day', () => {
  assert.deepEqual(at('明天下午3点开会'), ['2026-05-14T15:00', true, '开会']);
  assert.deepEqual(at('明天下午三点半开会'), ['2026-05-14T15:30', true, '开会']);
  assert.deepEqual(at('周五晚上8点聚餐'), ['2026-05-15T20:00', true, '聚餐']);
  assert.deepEqual(at('明天上午9点15分电话'), ['2026-05-14T09:15', true, '电话']);
  assert.deepEqual(at('后天中午12点吃饭'), ['2026-05-15T12:00', true, '吃饭']);
  assert.deepEqual(at('明天早上8点一刻出发'), ['2026-05-14T08:15', true, '出发']);
  assert.deepEqual(at('今晚10点交作业'), ['2026-05-13T22:00', true, '交作业']);
});

test('a bare small hour is taken as afternoon', () => {
  assert.deepEqual(at('明天3点开会'), ['2026-05-14T15:00', true, '开会']);
  assert.deepEqual(at('明天9点开会'), ['2026-05-14T09:00', true, '开会']);
});

test('a time with no day rolls to tomorrow once it has passed', () => {
  assert.deepEqual(at('15:30 取快递'), ['2026-05-13T15:30', true, '取快递']);
  assert.deepEqual(at('上午9点 晨会'), ['2026-05-14T09:00', true, '晨会']);
});

test('relative hours and minutes', () => {
  assert.deepEqual(at('2小时后提醒我喝水'), ['2026-05-13T12:00', true, '提醒我喝水']);
  assert.deepEqual(at('半小时后关火'), ['2026-05-13T10:30', true, '关火']);
  assert.deepEqual(at('20分钟后开会'), ['2026-05-13T10:20', true, '开会']);
});

test('English phrases', () => {
  assert.deepEqual(at('submit report tomorrow at 3pm'), ['2026-05-14T15:00', true, 'submit report']);
  assert.deepEqual(at('call dentist Friday 3:30pm'), ['2026-05-15T15:30', true, 'call dentist']);
  assert.deepEqual(at('review next monday'), ['2026-05-18T00:00', false, 'review']);
  assert.deepEqual(at('pay rent in 3 days'), ['2026-05-16T00:00', false, 'pay rent']);
  assert.deepEqual(at('ship Jun 5'), ['2026-06-05T00:00', false, 'ship']);
  assert.deepEqual(at('standup today 17:00'), ['2026-05-13T17:00', true, 'standup']);
});

test('text with no date is left alone', () => {
  assert.deepEqual(at('买牛奶'), [null, false, '买牛奶']);
  assert.deepEqual(at('读完第3章'), [null, false, '读完第3章']);
  assert.deepEqual(at('整理 5 份简历'), [null, false, '整理 5 份简历']);
  assert.deepEqual(at('monitor the build'), [null, false, 'monitor the build']);
});

test('impossible dates are not invented', () => {
  assert.deepEqual(at('2月30日'), [null, false, '2月30日']);
});
