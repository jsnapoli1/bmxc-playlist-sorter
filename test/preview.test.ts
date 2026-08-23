import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { cleanTitle, isPlausibleMatch, primaryArtist } from '../src/lib/preview.ts'

test('a plain title is left alone', () => {
  // Arrange / Act / Assert
  assert.equal(cleanTitle('Mr. Blue Sky'), 'Mr. Blue Sky')
})

test('remaster and version tags are stripped', () => {
  // Arrange / Act / Assert — these stop an iTunes title matching.
  assert.equal(cleanTitle('Don’t Stop Me Now (Remastered 2011)'), 'Don’t Stop Me Now')
  assert.equal(cleanTitle('Here Comes the Sun - Remastered 2009'), 'Here Comes the Sun')
  assert.equal(cleanTitle('Dancing Queen (Live)'), 'Dancing Queen')
  assert.equal(cleanTitle('Riptide - Radio Edit'), 'Riptide')
})

test('featured artists are stripped from the title', () => {
  // Arrange / Act / Assert
  assert.equal(cleanTitle('Home (feat. Jade)'), 'Home')
  assert.equal(cleanTitle('Sunday Best feat. Someone'), 'Sunday Best')
})

test('a meaningful parenthetical is kept', () => {
  // Arrange — this subtitle is part of the song's actual name.
  const title = 'Oceans (Where Feet May Fail)'

  // Act / Assert
  assert.equal(cleanTitle(title), title)
})

test('only the first artist is searched for', () => {
  // Arrange / Act / Assert
  assert.equal(primaryArtist('The Weeknd'), 'The Weeknd')
  assert.equal(primaryArtist('Edward Sharpe & The Magnetic Zeros'), 'Edward Sharpe')
  assert.equal(primaryArtist('Artist A, Artist B'), 'Artist A')
  assert.equal(primaryArtist('Someone feat. Another'), 'Someone')
})

test('an empty artist string is handled', () => {
  // Arrange / Act / Assert
  assert.equal(primaryArtist(''), '')
})

test('identical titles match', () => {
  // Arrange / Act / Assert
  assert.equal(isPlausibleMatch('Mr. Blue Sky', 'Mr. Blue Sky'), true)
})

test('matching ignores case and punctuation', () => {
  // Arrange / Act / Assert — iTunes capitalises differently.
  assert.equal(isPlausibleMatch('Island in the Sun', 'Island In the Sun'), true)
  assert.equal(isPlausibleMatch("Don't Stop Me Now", 'Dont Stop Me Now'), true)
})

test('an iTunes subtitle still counts as a match', () => {
  // Arrange / Act / Assert
  assert.equal(isPlausibleMatch('Oceans', 'Oceans (Where Feet May Fail)'), true)
  assert.equal(isPlausibleMatch('10,000 Reasons', '10,000 Reasons (Bless the Lord)'), true)
})

test('a different song is not treated as a match', () => {
  // Arrange — the case that would otherwise play the wrong thing.
  // Act / Assert
  assert.equal(isPlausibleMatch('Mr. Blue Sky', 'Blue Monday'), false)
  assert.equal(isPlausibleMatch('Riptide', 'Rip Tide Blues Explosion'), false)
  assert.equal(isPlausibleMatch('Home', 'Homeward Bound'), false)
})

test('an empty title never matches', () => {
  // Arrange / Act / Assert
  assert.equal(isPlausibleMatch('', 'Anything'), false)
  assert.equal(isPlausibleMatch('Anything', ''), false)
})

test('a title that is only punctuation never matches', () => {
  // Arrange / Act / Assert — normalising leaves nothing to compare.
  assert.equal(isPlausibleMatch('!!!', '???'), false)
})

test('cleaning a title never empties a real song name', () => {
  // Arrange — a song genuinely called "Live" must survive the Live stripper.
  const names = ['Live', 'Version', 'Home', 'Alive']

  // Act / Assert
  for (const name of names) {
    assert.ok(cleanTitle(name).length > 0, `"${name}" was stripped to nothing`)
  }
})
