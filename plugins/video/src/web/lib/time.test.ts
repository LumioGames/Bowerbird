import { describe, expect, it } from 'vitest'
import { fitEdge, frameAt, frameCount, frameFileName, loopNext, posterTime, sampleTimes, spriteIndex, spriteTile, stepFrame, timecode, timeOfFrame, undecodableMessage } from './time.js'

describe('video time maths', () => {
  it('formats timecodes', () => {
    expect(timecode(0)).toBe('00:00.00')
    expect(timecode(61.257)).toBe('01:01.25')
  })
  it('counts and steps frames', () => {
    expect(frameAt(1, 30)).toBe(30)
    expect(frameAt(timeOfFrame(37, 30), 30)).toBe(37)
    expect(frameCount(3, 30)).toBe(90)
    expect(frameAt(stepFrame(1, 30, 3, 1), 30)).toBe(31)
    expect(frameAt(stepFrame(0, 30, 3, -1), 30)).toBe(0)
    expect(frameAt(stepFrame(2.99, 30, 3, 1), 30)).toBe(89)
  })
  it('samples the scrub sprite and the poster', () => {
    expect(sampleTimes(10, 5)).toEqual([1, 3, 5, 7, 9])
    expect(posterTime(30)).toBe(3)
    expect(spriteIndex(0)).toBe(0)
    expect(spriteIndex(0.999)).toBe(24)
    expect(spriteIndex(1)).toBe(24)
    expect(spriteTile(7, 160, 90)).toEqual({ x: 320, y: 90, w: 160, h: 90 })
  })
  it('fits a long edge without upscaling', () => {
    expect(fitEdge(1920, 1080, 512)).toEqual({ w: 512, h: 288 })
    expect(fitEdge(320, 180, 1024)).toEqual({ w: 320, h: 180 })
  })
  it('loops between in and out points', () => {
    expect(loopNext(1, 0.5, 2, true)).toEqual({ t: 1, stop: false })
    expect(loopNext(2.01, 0.5, 2, true)).toEqual({ t: 0.5, stop: false })
    expect(loopNext(2.01, 0.5, 2, false)).toEqual({ t: 2, stop: true })
  })
  it('names saved frames and undecodable codecs', () => {
    expect(frameFileName('intro.v2.mp4', 7)).toBe('intro.v2_f007.png')
    expect(undecodableMessage('ProRes 4444')).toBe('这台电脑的浏览器放不了这种视频（ProRes 4444）')
  })
})
