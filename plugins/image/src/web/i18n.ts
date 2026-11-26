/**
 * The plugin's own strings in every shell language, on the SDK helper (ADR-061). Components read the shell's
 * language (`useT`); plain functions the shell calls (compareModes, techLabels) read the page language (`t`).
 * A language the dictionaries do not have yet falls back to English, then Chinese.
 */
import { defineMessages, pageLocale, translate as lookUp, useMessages } from '@bowerbird/plugin-sdk/web'

const ZH = {
  // the new-file hint (FormatView.intro, ADR-064)
  intro: '能看单个通道、取色，平铺检查接缝。',
  play: '播放', pause: '暂停', playKey: '播放 空格', pauseKey: '暂停 空格', prevFrame: '上一帧', nextFrame: '下一帧', frameOf: '帧 {i} / {n}',
  views: '视图', whole: '整图', 'view.front': '正', 'view.side': '侧', 'view.back': '背', 'view.top': '顶',
  fit: '适应', fitTitle: '适应窗口', one: '1:1', oneTitle: '原始大小',
  'bg.checker': '棋盘格', 'bg.black': '黑', 'bg.white': '白', bgAria: '{name}背景', customColor: '自定义颜色', customColorAria: '自定义背景颜色',
  channels: '通道', alpha: '透明度', tile: '平铺', copyAria: '复制 {hex}', copied: '已复制 {hex}',
  viewerError: '查看器出错了', download: '下载原文件', retry: '重试', tooLarge: '图片尺寸 {w}×{h} 超出浏览器能显示的上限',
  'axis.w': '宽', 'axis.h': '高', 'axis.d': '深',
  zoomOut: '缩小', zoomIn: '放大', fitDbl: '适应 · 双击画面', align: '对齐', alignAria: '对齐方式', alignFit: '按比例', alignPx: '原始像素',
  opacityAria: 'B 的不透明度', computing: '计算中', diffFailed: '无法计算差异', diffNone: '没有差异', diffShare: '不同 {p}%', current: '当前',
  reasonAspect: '两张图的比例不一样，差异看不出东西', reasonSliceNoRect: '这张切图没有记下它在原图上的区域，只能并排',
  // compare-table labels of the tech keys
  'tech.width': '宽', 'tech.height': '高', 'tech.channels': '通道数', 'tech.hasAlpha': '透明通道', 'tech.colorSpace': '色彩空间', 'tech.frames': '帧数', 'tech.dpi': 'DPI',
  // the inspector's 技术信息 (techRows) and the colour spaces that need words
  'tech.row.size': '尺寸', 'tech.row.yes': '有', 'tech.row.no': '无',
  'space.rgb16': 'RGB 16 位', 'space.b-w': '灰度', 'space.grey16': '灰度 16 位'
} as const
export type Key = keyof typeof ZH

const EN: Record<Key, string> = {
  intro: 'View single channels, pick colours, and tile it to check the seams.',
  play: 'Play', pause: 'Pause', playKey: 'Play  Space', pauseKey: 'Pause  Space', prevFrame: 'Previous frame', nextFrame: 'Next frame', frameOf: 'Frame {i} / {n}',
  views: 'Views', whole: 'Sheet', 'view.front': 'Front', 'view.side': 'Side', 'view.back': 'Back', 'view.top': 'Top',
  fit: 'Fit', fitTitle: 'Fit to window', one: '1:1', oneTitle: 'Actual size',
  'bg.checker': 'Checkerboard', 'bg.black': 'Black', 'bg.white': 'White', bgAria: '{name} background', customColor: 'Custom colour', customColorAria: 'Custom background colour',
  channels: 'Channels', alpha: 'Alpha', tile: 'Tile', copyAria: 'Copy {hex}', copied: 'Copied {hex}',
  viewerError: 'The viewer failed', download: 'Download original', retry: 'Retry', tooLarge: 'The image is {w}×{h}, larger than a browser can show',
  'axis.w': 'W', 'axis.h': 'H', 'axis.d': 'D',
  zoomOut: 'Zoom out', zoomIn: 'Zoom in', fitDbl: 'Fit · double-click the picture', align: 'Align', alignAria: 'Alignment', alignFit: 'Proportional', alignPx: 'Original pixels',
  opacityAria: 'Opacity of B', computing: 'Computing', diffFailed: 'Could not compute the difference', diffNone: 'No difference', diffShare: '{p}% different', current: 'current',
  reasonAspect: 'The two pictures have different proportions; a pixel difference would show nothing useful', reasonSliceNoRect: 'This slice did not record where it was cut from, so it can only sit side by side',
  'tech.width': 'Width', 'tech.height': 'Height', 'tech.channels': 'Channels', 'tech.hasAlpha': 'Alpha channel', 'tech.colorSpace': 'Colour space', 'tech.frames': 'Frames', 'tech.dpi': 'DPI',
  'tech.row.size': 'Size', 'tech.row.yes': 'Yes', 'tech.row.no': 'No',
  'space.rgb16': '16-bit RGB', 'space.b-w': 'Greyscale', 'space.grey16': '16-bit greyscale'
}

const JA: Record<Key, string> = {
  intro: 'チャンネルを個別に表示したり、色を拾ったり、タイル表示で継ぎ目を確かめたりできます。',
  play: '再生', pause: '一時停止', playKey: '再生  スペース', pauseKey: '一時停止  スペース', prevFrame: '前のフレーム', nextFrame: '次のフレーム', frameOf: 'フレーム {i} / {n}',
  views: 'ビュー', whole: '全体', 'view.front': '正面', 'view.side': '側面', 'view.back': '背面', 'view.top': '上面',
  fit: '全体表示', fitTitle: 'ウィンドウに合わせる', one: '1:1', oneTitle: '原寸',
  'bg.checker': 'チェッカー', 'bg.black': '黒', 'bg.white': '白', bgAria: '{name}の背景', customColor: 'カスタムカラー', customColorAria: '背景のカスタムカラー',
  channels: 'チャンネル', alpha: 'アルファ', tile: 'タイル', copyAria: '{hex} をコピー', copied: '{hex} をコピーしました',
  viewerError: 'ビューアでエラーが発生しました', download: '元ファイルをダウンロード', retry: '再試行', tooLarge: '画像サイズ {w}×{h} はブラウザで表示できる上限を超えています',
  'axis.w': '幅', 'axis.h': '高さ', 'axis.d': '奥行き',
  zoomOut: '縮小', zoomIn: '拡大', fitDbl: '全体表示 · 画面をダブルクリック', align: '位置合わせ', alignAria: '位置合わせの方法', alignFit: '比率で合わせる', alignPx: '元のピクセル',
  opacityAria: 'B の不透明度', computing: '計算中', diffFailed: '差分を計算できません', diffNone: '差分はありません', diffShare: '{p}% が異なります', current: '現在',
  reasonAspect: '2 枚の画像は縦横比が異なるため、差分を表示しても意味がありません', reasonSliceNoRect: 'このスライスには元画像のどの範囲から切り出したかの記録がないため、並べて表示することしかできません',
  'tech.width': '幅', 'tech.height': '高さ', 'tech.channels': 'チャンネル数', 'tech.hasAlpha': 'アルファチャンネル', 'tech.colorSpace': '色空間', 'tech.frames': 'フレーム数', 'tech.dpi': 'DPI',
  'tech.row.size': 'サイズ', 'tech.row.yes': 'あり', 'tech.row.no': 'なし',
  'space.rgb16': 'RGB 16 ビット', 'space.b-w': 'グレースケール', 'space.grey16': 'グレースケール 16 ビット'
}

const KO: Record<Key, string> = {
  intro: '채널을 하나씩 보고, 색을 찍고, 타일로 이어 붙여 이음새를 확인할 수 있어요.',
  play: '재생', pause: '일시정지', playKey: '재생  Space', pauseKey: '일시정지  Space', prevFrame: '이전 프레임', nextFrame: '다음 프레임', frameOf: '프레임 {i} / {n}',
  views: '뷰', whole: '전체', 'view.front': '정면', 'view.side': '측면', 'view.back': '후면', 'view.top': '윗면',
  fit: '맞춤', fitTitle: '창에 맞추기', one: '1:1', oneTitle: '원본 크기',
  'bg.checker': '체커보드', 'bg.black': '검정', 'bg.white': '흰색', bgAria: '{name} 배경', customColor: '사용자 지정 색', customColorAria: '배경 사용자 지정 색',
  channels: '채널', alpha: '알파', tile: '타일', copyAria: '{hex} 복사', copied: '{hex}을(를) 복사했어요',
  viewerError: '뷰어에 오류가 생겼어요', download: '원본 파일 다운로드', retry: '다시 시도', tooLarge: '이미지 크기 {w}×{h}가 브라우저에서 표시할 수 있는 한도를 넘어요',
  'axis.w': '너비', 'axis.h': '높이', 'axis.d': '깊이',
  zoomOut: '축소', zoomIn: '확대', fitDbl: '맞춤 · 화면 더블 클릭', align: '정렬', alignAria: '정렬 방식', alignFit: '비율 맞춤', alignPx: '원본 픽셀',
  opacityAria: 'B의 불투명도', computing: '계산 중', diffFailed: '차이를 계산할 수 없어요', diffNone: '차이가 없어요', diffShare: '{p}% 달라요', current: '현재',
  reasonAspect: '두 이미지의 비율이 달라서 차이를 봐도 알 수 있는 게 없어요', reasonSliceNoRect: '이 슬라이스는 원본에서 잘라 낸 영역이 기록되지 않아서 나란히 보기만 할 수 있어요',
  'tech.width': '너비', 'tech.height': '높이', 'tech.channels': '채널 수', 'tech.hasAlpha': '알파 채널', 'tech.colorSpace': '색 공간', 'tech.frames': '프레임 수', 'tech.dpi': 'DPI',
  'tech.row.size': '크기', 'tech.row.yes': '있음', 'tech.row.no': '없음',
  'space.rgb16': 'RGB 16비트', 'space.b-w': '그레이스케일', 'space.grey16': '그레이스케일 16비트'
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
