import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activeDuration,
  keptRanges,
  activeToSource,
  sourceToActive,
  clampPipPosition,
  maxPipSize,
} from './timeline.js'

test('no pauses: active time equals wall time', () => {
  assert.equal(activeDuration(10, []), 10)
  assert.deepEqual(keptRanges(10, []), [[0, 10]])
  assert.equal(activeToSource(3.5, [[0, 10]]), 3.5)
  assert.equal(sourceToActive(3.5, [[0, 10]]), 3.5)
})

test('a pause in the middle produces two kept ranges', () => {
  const ranges = keptRanges(10, [{ start: 4, end: 6 }])
  assert.deepEqual(ranges, [
    [0, 4],
    [6, 10],
  ])
  assert.equal(activeDuration(10, [{ start: 4, end: 6 }]), 8)

  assert.equal(activeToSource(0, ranges), 0)
  assert.equal(activeToSource(4, ranges), 4)
  assert.ok(activeToSource(4.5, ranges) > 6)
  assert.equal(activeToSource(8, ranges), 10)

  assert.equal(sourceToActive(5, ranges), 4) // inside the gap -> clamped
  assert.equal(sourceToActive(10, ranges), 8)
})

test('active <-> source mapping round-trips inside kept ranges', () => {
  const ranges = keptRanges(12, [
    { start: 2, end: 3 },
    { start: 7, end: 9 },
  ])
  assert.deepEqual(ranges, [
    [0, 2],
    [3, 7],
    [9, 12],
  ])
  assert.equal(activeDuration(12, [
    { start: 2, end: 3 },
    { start: 7, end: 9 },
  ]), 9)

  for (const active of [0, 1, 2, 3, 5, 6, 7, 8, 9]) {
    const wall = activeToSource(active, ranges)
    assert.ok(Math.abs(sourceToActive(wall, ranges) - active) < 1e-9)
  }
})

test('pausing then stopping closes the final segment cleanly', () => {
  const segments = [{ start: 7, end: 10 }]
  assert.deepEqual(keptRanges(10, segments), [[0, 7]])
  assert.equal(activeDuration(10, segments), 7)
  assert.equal(activeToSource(7, keptRanges(10, segments)), 7)
})

test('pause bounds are clamped to the recording duration', () => {
  assert.deepEqual(keptRanges(5, [{ start: 4, end: 99 }]), [[0, 4]])
  assert.deepEqual(keptRanges(5, [{ start: -2, end: 1 }]), [[1, 5]])
})

test('PiP position clamps so the circle stays inside the frame', () => {
  const aspect = 16 / 9
  assert.deepEqual(clampPipPosition(-1, 2, 0.2, aspect), {
    x: 0.1,
    y: 1 - (0.2 * aspect) / 2,
  })
  assert.deepEqual(clampPipPosition(0.5, 0.5, 0.2, aspect), { x: 0.5, y: 0.5 })
})

test('PiP size is bounded by the available space at its centre', () => {
  const aspect = 16 / 9
  assert.equal(maxPipSize(0.5, 0.5, aspect), 0.4)
  assert.ok(maxPipSize(0.1, 0.1, aspect) < 0.2)
  assert.ok(maxPipSize(0.05, 0.5, aspect) <= 0.1)
})
