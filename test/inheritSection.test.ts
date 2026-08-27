import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { inferredSection, inferSections, type Placed } from '../src/lib/inheritSection.ts'

/** The app pushes songs grouped by section, so Spotify looks like this. */
function known(...pairs: [string, string | undefined][]): Map<string, Placed> {
  return new Map(pairs.map(([id, sectionId]) => [id, { id, sectionId }]))
}

test('a song added between two songs of one section joins it', () => {
  // Arrange: run, [new], run
  const order = ['a', 'NEW', 'b']
  const plan = known(['a', 'sec_run'], ['b', 'sec_run'])

  // Act
  const section = inferredSection(order, plan, 'NEW')

  // Assert
  assert.equal(section, 'sec_run')
})

test('a song on a boundary between two sections is left unsorted', () => {
  // Guessing which side was meant would be wrong about half the time.
  const order = ['a', 'NEW', 'b']
  const plan = known(['a', 'sec_run'], ['b', 'sec_lake'])
  assert.equal(inferredSection(order, plan, 'NEW'), undefined)
})

test('a song appended at the end is left unsorted', () => {
  // Adding to the end of a playlist is the ordinary way to add a song and
  // says nothing about sections.
  const order = ['a', 'b', 'NEW']
  const plan = known(['a', 'sec_run'], ['b', 'sec_run'])
  assert.equal(inferredSection(order, plan, 'NEW'), undefined)
})

test('a song added at the very start is left unsorted', () => {
  const order = ['NEW', 'a', 'b']
  const plan = known(['a', 'sec_run'], ['b', 'sec_run'])
  assert.equal(inferredSection(order, plan, 'NEW'), undefined)
})

test('several songs pasted into one section all inherit it', () => {
  // Each new song neighbours another new song, so a naive look at the
  // immediate neighbours would give up on all of them.
  const order = ['a', 'N1', 'N2', 'N3', 'b']
  const plan = known(['a', 'sec_lake'], ['b', 'sec_lake'])

  const got = inferSections(order, plan, ['N1', 'N2', 'N3'])

  assert.equal(got.get('N1'), 'sec_lake')
  assert.equal(got.get('N2'), 'sec_lake')
  assert.equal(got.get('N3'), 'sec_lake')
})

test('a song between two unsorted songs stays unsorted', () => {
  // Unsorted is the absence of a section, not a section to inherit.
  const order = ['a', 'NEW', 'b']
  const plan = known(['a', undefined], ['b', undefined])
  assert.equal(inferredSection(order, plan, 'NEW'), undefined)
})

test('a song whose neighbours are unknown is left unsorted', () => {
  const order = ['x', 'NEW', 'y']
  assert.equal(inferredSection(order, new Map(), 'NEW'), undefined)
})

test('a song not in the reported order is left unsorted', () => {
  const order = ['a', 'b']
  const plan = known(['a', 'sec_run'], ['b', 'sec_run'])
  assert.equal(inferredSection(order, plan, 'MISSING'), undefined)
})

test('inferSections only reports songs it could resolve', () => {
  // 'END' is appended and unresolvable; it must not appear at all rather
  // than appear with an empty section.
  const order = ['a', 'MID', 'b', 'END']
  const plan = known(['a', 'sec_run'], ['b', 'sec_run'])

  const got = inferSections(order, plan, ['MID', 'END'])

  assert.equal(got.get('MID'), 'sec_run')
  assert.equal(got.has('END'), false)
  assert.equal(got.size, 1)
})
