/**
 * The plugin's own strings in every shell language, on the SDK helper (ADR-061). Components read the shell's
 * language (`useT`); plain functions the shell calls (compareModes, techLabels, formatBadge) read the page language
 * or are handed one. A language the dictionaries do not have yet falls back to English, then Chinese.
 */
import { defineMessages, pageLocale, translate as lookUp, useMessages } from '@bowerbird/plugin-sdk/web'

const ZH = {
  play: '播放', pause: '暂停', playKey: '播放 空格', pauseKey: '暂停 空格', loop: '循环', volume: '音量',
  display: '显示', wave: '波形', spectrum: '频谱', peak: '峰值 {v} dB', clips: '削波 {n} 处', clip: '削波',
  listening: '正在听', flip: '切换', flipTitle: '在 A 和 B 之间切换，位置不变', listen: '听 {k}', current: '当前',
  reasonAudio: '音频按上下两条波形对齐',
  // the grid badge under ten seconds (「0.8 秒」, written by the server part)
  seconds: '{s} 秒',
  // compare-table labels of the tech keys
  'tech.duration': '时长', 'tech.channels': '声道', 'tech.sampleRate': '采样率', 'tech.bitDepth': '位深', 'tech.codec': '编码', 'tech.loudness': '响度', 'tech.peak': '峰值',
  // the inspector's 技术信息 (techRows)
  'tech.row.mono': '单声道', 'tech.row.stereo': '立体声', 'tech.row.channelsN': '{n} 声道'
} as const
export type Key = keyof typeof ZH

const EN: Record<Key, string> = {
  play: 'Play', pause: 'Pause', playKey: 'Play  Space', pauseKey: 'Pause  Space', loop: 'Loop', volume: 'Volume',
  display: 'Display', wave: 'Waveform', spectrum: 'Spectrum', peak: 'Peak {v} dB', clips: '{n} clipped', clip: 'Clipped',
  listening: 'Listening to', flip: 'Switch', flipTitle: 'Switch between A and B, keeping the position', listen: 'Listen to {k}', current: 'current',
  reasonAudio: 'Audio is compared as two waveforms one above the other',
  seconds: '{s} s',
  'tech.duration': 'Duration', 'tech.channels': 'Channels', 'tech.sampleRate': 'Sample rate', 'tech.bitDepth': 'Bit depth', 'tech.codec': 'Codec', 'tech.loudness': 'Loudness', 'tech.peak': 'Peak',
  'tech.row.mono': 'Mono', 'tech.row.stereo': 'Stereo', 'tech.row.channelsN': '{n} channels'
}

const JA: Record<Key, string> = {
  play: '再生', pause: '一時停止', playKey: '再生  スペース', pauseKey: '一時停止  スペース', loop: 'ループ', volume: '音量',
  display: '表示', wave: '波形', spectrum: 'スペクトル', peak: 'ピーク {v} dB', clips: 'クリップ {n} 箇所', clip: 'クリップ',
  listening: '再生中', flip: '切り替え', flipTitle: '再生位置を保ったまま A と B を切り替えます', listen: '{k} を聴く', current: '現在',
  reasonAudio: '音声は 2 本の波形を上下に並べて比較します',
  seconds: '{s} 秒',
  'tech.duration': '長さ', 'tech.channels': 'チャンネル', 'tech.sampleRate': 'サンプルレート', 'tech.bitDepth': 'ビット深度', 'tech.codec': 'コーデック', 'tech.loudness': 'ラウドネス', 'tech.peak': 'ピーク',
  'tech.row.mono': 'モノラル', 'tech.row.stereo': 'ステレオ', 'tech.row.channelsN': '{n} チャンネル'
}

const KO: Record<Key, string> = {
  play: '재생', pause: '일시정지', playKey: '재생  Space', pauseKey: '일시정지  Space', loop: '반복', volume: '볼륨',
  display: '표시', wave: '파형', spectrum: '스펙트럼', peak: '피크 {v} dB', clips: '클리핑 {n}곳', clip: '클리핑',
  listening: '듣는 중', flip: '전환', flipTitle: '재생 위치를 유지한 채 A와 B를 전환해요', listen: '{k} 듣기', current: '현재',
  reasonAudio: '오디오는 두 파형을 위아래로 맞춰 비교해요',
  seconds: '{s}초',
  'tech.duration': '길이', 'tech.channels': '채널', 'tech.sampleRate': '샘플레이트', 'tech.bitDepth': '비트 심도', 'tech.codec': '코덱', 'tech.loudness': '라우드니스', 'tech.peak': '피크',
  'tech.row.mono': '모노', 'tech.row.stereo': '스테레오', 'tech.row.channelsN': '{n}채널'
}

export const messages = defineMessages({ 'zh-CN': ZH, en: EN, ja: JA, ko: KO })

/** One string in a language (the language, then English, then Chinese). */
export function translate(locale: string, key: Key, params?: Record<string, string | number>): string { return lookUp(messages, locale, key, params) }

/** A translator for one language (plain functions the shell hands a locale: formatBadge, techRows). */
export type T = (key: Key, params?: Record<string, string | number>) => string
export const inLocale = (locale: string): T => (key, params) => translate(locale, key, params)

/** Translation outside components (the page language the shell set on `<html lang>`). */
export function t(key: Key, params?: Record<string, string | number>): string { return translate(pageLocale(), key, params) }

/** Translation in components (the shell's language; re-renders when it changes). */
export function useT(): (key: Key, params?: Record<string, string | number>) => string { return useMessages(messages) }
