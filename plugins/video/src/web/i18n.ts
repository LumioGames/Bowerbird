/**
 * The plugin's own strings in every shell language, on the SDK helper (ADR-061). Components read the shell's
 * language (`useT`); plain functions the shell calls (compareModes, techLabels, render failures) read the page
 * language (`t`). A language the dictionaries do not have yet falls back to English, then Chinese.
 */
import { defineMessages, pageLocale, translate as lookUp, useMessages } from '@bowerbird/plugin-sdk/web'

const ZH = {
  play: '播放', pause: '暂停', playKey: '播放 空格', pauseKey: '暂停 空格', prevFrame: '上一帧', nextFrame: '下一帧', frame: '帧 {i} / {n}',
  loop: '循环', speed: '倍速', volume: '音量', inTitle: '把入点设在当前位置', in: '入点', outTitle: '把出点设在当前位置', out: '出点', more: '更多',
  setThumb: '把当前帧设为缩略图', saveFrame: '把当前帧另存为图片资产', thumbDone: '已把第 {n} 帧设为缩略图', thumbFailed: '没能设为缩略图',
  frameSaved: '已另存为 {name}，来源指向这个视频', open: '查看', frameFailed: '没能另存为图片',
  undecodable: '当前浏览器无法解码这个视频', unknownCodec: '未知编码', viewerError: '查看器出错了', retry: '重试', download: '下载原文件',
  cannotPlay: '这台电脑的浏览器放不了这种视频', cannotPlayCodec: '这台电脑的浏览器放不了这种视频（{codec}）', timeout: '读取超时', cancelled: '已取消',
  readFailed: '视频读取失败', encodeFailed: '无法编码图片', reasonVideo: '视频只能并排或卷帘', current: '当前', ends: '{k} 结束',
  // compare-table labels of the tech keys
  'tech.duration': '时长', 'tech.width': '宽', 'tech.height': '高', 'tech.frameRate': '帧率', 'tech.codec': '编码', 'tech.hasAudio': '声音',
  // the inspector's 技术信息 (techRows)
  'tech.row.resolution': '分辨率'
} as const
export type Key = keyof typeof ZH

const EN: Record<Key, string> = {
  play: 'Play', pause: 'Pause', playKey: 'Play  Space', pauseKey: 'Pause  Space', prevFrame: 'Previous frame', nextFrame: 'Next frame', frame: 'Frame {i} / {n}',
  loop: 'Loop', speed: 'Speed', volume: 'Volume', inTitle: 'Set the in point here', in: 'In', outTitle: 'Set the out point here', out: 'Out', more: 'More',
  setThumb: 'Use this frame as the thumbnail', saveFrame: 'Save this frame as an image asset', thumbDone: 'Frame {n} is now the thumbnail', thumbFailed: 'Could not set the thumbnail',
  frameSaved: 'Saved as {name}, with this video as its source', open: 'Open', frameFailed: 'Could not save the frame',
  undecodable: 'This browser cannot decode this video', unknownCodec: 'Unknown codec', viewerError: 'The viewer failed', retry: 'Retry', download: 'Download original',
  cannotPlay: "This computer's browser cannot play this video", cannotPlayCodec: "This computer's browser cannot play this video ({codec})", timeout: 'Reading timed out', cancelled: 'Cancelled',
  readFailed: 'Could not read the video', encodeFailed: 'Could not encode the image', reasonVideo: 'Videos can only be compared side by side or with the wipe', current: 'current', ends: '{k} ends',
  'tech.duration': 'Duration', 'tech.width': 'Width', 'tech.height': 'Height', 'tech.frameRate': 'Frame rate', 'tech.codec': 'Codec', 'tech.hasAudio': 'Sound',
  'tech.row.resolution': 'Resolution'
}

const JA: Record<Key, string> = {
  play: '再生', pause: '一時停止', playKey: '再生  スペース', pauseKey: '一時停止  スペース', prevFrame: '前のフレーム', nextFrame: '次のフレーム', frame: 'フレーム {i} / {n}',
  loop: 'ループ', speed: '再生速度', volume: '音量', inTitle: '現在位置をイン点にします', in: 'イン点', outTitle: '現在位置をアウト点にします', out: 'アウト点', more: 'その他',
  setThumb: '現在のフレームをサムネイルにする', saveFrame: '現在のフレームを画像アセットとして保存', thumbDone: 'フレーム {n} をサムネイルにしました', thumbFailed: 'サムネイルに設定できませんでした',
  frameSaved: '{name} として保存しました。ソースはこの動画です', open: '表示', frameFailed: '画像として保存できませんでした',
  undecodable: 'このブラウザではこの動画をデコードできません', unknownCodec: '不明なコーデック', viewerError: 'ビューアでエラーが発生しました', retry: '再試行', download: '元ファイルをダウンロード',
  cannotPlay: 'このコンピュータのブラウザではこの形式の動画を再生できません', cannotPlayCodec: 'このコンピュータのブラウザではこの形式の動画を再生できません（{codec}）', timeout: '読み込みがタイムアウトしました', cancelled: 'キャンセルしました',
  readFailed: '動画を読み込めませんでした', encodeFailed: '画像をエンコードできません', reasonVideo: '動画は並べて表示するかワイプで比較することしかできません', current: '現在', ends: '{k} の終わり',
  'tech.duration': '長さ', 'tech.width': '幅', 'tech.height': '高さ', 'tech.frameRate': 'フレームレート', 'tech.codec': 'コーデック', 'tech.hasAudio': '音声',
  'tech.row.resolution': '解像度'
}

const KO: Record<Key, string> = {
  play: '재생', pause: '일시정지', playKey: '재생  Space', pauseKey: '일시정지  Space', prevFrame: '이전 프레임', nextFrame: '다음 프레임', frame: '프레임 {i} / {n}',
  loop: '반복', speed: '재생 속도', volume: '볼륨', inTitle: '현재 위치를 시작점으로 지정', in: '시작점', outTitle: '현재 위치를 끝점으로 지정', out: '끝점', more: '더 보기',
  setThumb: '현재 프레임을 썸네일로 지정', saveFrame: '현재 프레임을 이미지 에셋으로 저장', thumbDone: '{n}번째 프레임을 썸네일로 지정했어요', thumbFailed: '썸네일로 지정하지 못했어요',
  frameSaved: '{name}(으)로 저장했어요. 소스는 이 동영상이에요', open: '보기', frameFailed: '이미지로 저장하지 못했어요',
  undecodable: '이 브라우저에서는 이 동영상을 디코딩할 수 없어요', unknownCodec: '알 수 없는 코덱', viewerError: '뷰어에 오류가 생겼어요', retry: '다시 시도', download: '원본 파일 다운로드',
  cannotPlay: '이 컴퓨터의 브라우저에서는 이런 동영상을 재생할 수 없어요', cannotPlayCodec: '이 컴퓨터의 브라우저에서는 이런 동영상을 재생할 수 없어요({codec})', timeout: '읽기 시간이 초과됐어요', cancelled: '취소했어요',
  readFailed: '동영상을 읽지 못했어요', encodeFailed: '이미지를 인코딩할 수 없어요', reasonVideo: '동영상은 나란히 보기나 와이프로만 비교할 수 있어요', current: '현재', ends: '{k} 끝',
  'tech.duration': '길이', 'tech.width': '너비', 'tech.height': '높이', 'tech.frameRate': '프레임레이트', 'tech.codec': '코덱', 'tech.hasAudio': '소리',
  'tech.row.resolution': '해상도'
}

export const messages = defineMessages({ 'zh-CN': ZH, en: EN, ja: JA, ko: KO })

/** One string in a language (the language, then English, then Chinese). */
export function translate(locale: string, key: Key, params?: Record<string, string | number>): string { return lookUp(messages, locale, key, params) }

/** A translator for one language (plain functions the shell hands a locale: techRows). */
export type T = (key: Key, params?: Record<string, string | number>) => string
export const inLocale = (locale: string): T => (key, params) => translate(locale, key, params)

/** Translation outside components (the page language the shell set on `<html lang>`). */
export function t(key: Key, params?: Record<string, string | number>): string { return translate(pageLocale(), key, params) }

/** Translation in components (the shell's language; re-renders when it changes). */
export function useT(): (key: Key, params?: Record<string, string | number>) => string { return useMessages(messages) }
