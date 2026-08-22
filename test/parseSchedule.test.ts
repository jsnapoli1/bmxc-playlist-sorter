import { strict as assert } from 'node:assert'
import test from 'node:test'
import { parseSchedule, parseCsv, guessCategory } from '../src/lib/parseSchedule.ts'
import { parseTime, parseLeadingTimeRange, blockMinutes, formatRange } from '../src/lib/time.ts'

test('parseTime handles common camp-schedule spellings', () => {
  assert.equal(parseTime('9:00 AM'), '09:00')
  assert.equal(parseTime('9am'), '09:00')
  assert.equal(parseTime('12:30 p.m.'), '12:30')
  assert.equal(parseTime('12:30am'), '00:30')
  assert.equal(parseTime('21:05'), '21:05')
  assert.equal(parseTime('0930'), '09:30')
  assert.equal(parseTime('1430'), '14:30')
  assert.equal(parseTime('9.15'), '09:15')
  assert.equal(parseTime('noon'), '12:00')
  assert.equal(parseTime('lunch'), null)
  assert.equal(parseTime('9:75'), null)
})

test('parseLeadingTimeRange splits a range off the front of a line', () => {
  const r = parseLeadingTimeRange('7:30-8:00 Wake up @ Cabins')
  assert.deepEqual(r, {
    start: '07:30',
    end: '08:00',
    startExplicit: false,
    endExplicit: false,
    rest: 'Wake up @ Cabins',
  })

  const explicit = parseLeadingTimeRange('7:30 AM - 8:00 AM Wake up')
  assert.equal(explicit?.startExplicit, true)
  assert.equal(explicit?.endExplicit, true)

  const dash = parseLeadingTimeRange('12:30 p.m. – 1:45 p.m.  Lunch')
  assert.equal(dash?.start, '12:30')
  assert.equal(dash?.end, '13:45')
  assert.equal(dash?.rest, 'Lunch')

  assert.equal(parseLeadingTimeRange('Monday'), null)
  // A bare leading number that is really part of the title.
  assert.equal(parseLeadingTimeRange('5 Minute Warning'), null)
})

test('text schedules split into days and blocks', () => {
  const src = [
    'Monday',
    '7:30-8:00 Wake up @ Cabins',
    '8:00-8:45 Breakfast @ Dining Hall | announcements at 8:30',
    '  note: keep volume low until announcements are done',
    '9:00-10:15 Activity Period 1 [Activity]',
    'Tuesday',
    '7:30 Wake up',
  ].join('\n')

  const { days, blocks, warnings } = parseSchedule(src)
  assert.equal(warnings.length, 0)
  assert.equal(days.length, 2)
  assert.deepEqual(days.map((d) => d.label), ['Monday', 'Tuesday'])
  assert.equal(blocks.length, 4)

  const breakfast = blocks[1]
  assert.equal(breakfast.title, 'Breakfast')
  assert.equal(breakfast.location, 'Dining Hall')
  assert.equal(breakfast.category, 'Meal')
  assert.match(breakfast.notes, /announcements at 8:30/)
  assert.match(breakfast.notes, /keep volume low/)

  assert.equal(blocks[2].category, 'Activity')
  assert.equal(blocks[3].dayId, days[1].id)
  assert.equal(blocks[3].end, '')
})

test('csv reader handles quotes and embedded commas', () => {
  const rows = parseCsv('a,b\n"x, y",z\n"he said ""hi""",2\n')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x, y', 'z'],
    ['he said "hi"', '2'],
  ])
})

test('csv schedules map aliased headers', () => {
  const csv = [
    'Date,Start Time,End Time,Activity,Where,Details',
    'Monday,7:30 AM,8:00 AM,Wake Up,Cabins,"speaker on the porch, not inside"',
    'Monday,12:00 PM,1:00 PM,Lunch,Dining Hall,',
    'Tuesday,8:00 PM,9:30 PM,Campfire,Fire Ring,slow songs only',
  ].join('\n')

  const { days, blocks, warnings, format } = parseSchedule(csv)
  assert.equal(format, 'csv')
  assert.deepEqual(warnings, [])
  assert.equal(days.length, 2)
  assert.equal(blocks.length, 3)
  assert.equal(blocks[0].start, '07:30')
  assert.equal(blocks[0].location, 'Cabins')
  assert.equal(blocks[0].notes, 'speaker on the porch, not inside')
  assert.equal(blocks[2].category, 'Evening program')
})

test('ics files import as dated days', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:Breakfast',
    'DTSTART;TZID=America/New_York:20260622T080000',
    'DTEND;TZID=America/New_York:20260622T084500',
    'LOCATION:Dining Hall',
    'DESCRIPTION:Low volume until\\nannouncements',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:Evening Program',
    'DTSTART:20260622T200000',
    'DTEND:20260622T213000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  const { days, blocks, format } = parseSchedule(ics)
  assert.equal(format, 'ics')
  assert.equal(days.length, 1)
  assert.equal(days[0].date, '2026-06-22')
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].start, '08:00')
  assert.equal(blocks[0].end, '08:45')
  assert.match(blocks[0].notes, /announcements/)
  assert.equal(blocks[1].category, 'Evening program')
})

test('category guessing covers camp vocabulary', () => {
  assert.equal(guessCategory('Free Swim'), 'Free time')
  assert.equal(guessCategory('Lights Out'), 'Wind down')
  assert.equal(guessCategory('Flag Raising'), 'All-camp')
  assert.equal(guessCategory('Bus Departure'), 'Travel')
  assert.equal(guessCategory('Something Else'), 'Other')
})

test('block duration handles wraparound past midnight', () => {
  assert.equal(blockMinutes('20:00', '21:30'), 90)
  assert.equal(blockMinutes('23:30', '00:15'), 45)
  assert.equal(blockMinutes('09:00', ''), null)
  assert.equal(formatRange('09:00', '10:15'), '9:00 AM – 10:15 AM')
})

test('bare times are resolved forward through the day', () => {
  const src = [
    'Monday',
    '7:30-8:00 Wake up',
    '12:00-1:00 Lunch',
    '2:00-4:00 Free swim',
    '8:00-9:30 Campfire',
    '9:45 Lights out',
  ].join('\n')

  const { blocks, warnings } = parseSchedule(src)
  assert.deepEqual(
    blocks.map((b) => `${b.start}-${b.end}`),
    ['07:30-08:00', '12:00-13:00', '14:00-16:00', '20:00-21:30', '21:45-'],
  )
  assert.match(warnings[0], /without AM\/PM/)
})

test('stated AM/PM and 24-hour times are never shifted', () => {
  const src = [
    'Monday',
    '7:30 AM Wake up',
    '9:00 AM Chapel',
    '8:00 AM Late breakfast',
    '13:00 Rest hour',
    '9:00 AM Second chapel',
  ].join('\n')

  const { blocks, warnings } = parseSchedule(src)
  assert.deepEqual(
    blocks.map((b) => b.start),
    ['07:30', '09:00', '08:00', '13:00', '09:00'],
  )
  assert.deepEqual(warnings, [])
})

test('each day resolves its own clock independently', () => {
  const src = ['Monday', '8:00 Campfire', 'Tuesday', '7:30 Wake up'].join('\n')
  const { blocks } = parseSchedule(src)
  assert.equal(blocks[0].start, '08:00')
  assert.equal(blocks[1].start, '07:30')
})

test('csv bare times resolve the same way', () => {
  const csv = [
    'Day,Start,End,Activity',
    'Monday,7:30,8:00,Wake Up',
    'Monday,12:00,1:00,Lunch',
    'Monday,8:00,9:30,Campfire',
  ].join('\n')
  const { blocks } = parseSchedule(csv)
  assert.deepEqual(
    blocks.map((b) => `${b.start}-${b.end}`),
    ['07:30-08:00', '12:00-13:00', '20:00-21:30'],
  )
})
