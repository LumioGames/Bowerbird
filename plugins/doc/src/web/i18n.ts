/**
 * The plugin's own strings in every shell language, on the SDK helper (ADR-061). Components read the shell's
 * language (`useT`); plain functions the shell calls (compareModes, techLabels) read the page language (`t`).
 * A language the dictionaries do not have yet falls back to English, then Chinese.
 */
import { defineMessages, pageLocale, translate as lookUp, useMessages } from '@bowerbird/plugin-sdk/web'

const ZH = {
  // the new-file hint (FormatView.intro, ADR-064)
  intro: 'Markdown、网页原型、JSON 都能直接看。',
  display: '显示方式', typeset: '排版', raw: '原文', tree: '树形', run: '运行', source: '源码',
  viewport: '视口', 'vp.fit': '适应', 'vp.phone': '手机', 'vp.tablet': '平板', 'vp.desktop': '桌面', viewerError: '查看器出错了',
  targetSize: '目标尺寸', missingTarget: '指向的文件找不到了',
  'stage.reference': '参考', 'stage.production': '生产', 'stage.runtime': '运行时',
  'review.pending': '待审', 'review.approved': '通过', 'review.rejected': '打回', 'review.exempt': '免审',
  lines: '行', current: '当前', reasonText: '文本按行显示差异', reasonHtml: '网页原型只能并排',
  // compare-table labels of the tech keys
  'tech.title': '标题', 'tech.lines': '行数', 'tech.words': '字数', 'tech.targetWidth': '目标宽', 'tech.targetHeight': '目标高', 'tech.targetDepth': '目标深'
} as const
export type Key = keyof typeof ZH

const EN: Record<Key, string> = {
  intro: 'Markdown, web prototypes and JSON open right here.',
  display: 'Display', typeset: 'Formatted', raw: 'Source', tree: 'Tree', run: 'Run', source: 'Source',
  viewport: 'Viewport', 'vp.fit': 'Fit', 'vp.phone': 'Phone', 'vp.tablet': 'Tablet', 'vp.desktop': 'Desktop', viewerError: 'The viewer failed',
  targetSize: 'Target size', missingTarget: 'Points to a missing file',
  'stage.reference': 'Reference', 'stage.production': 'Production', 'stage.runtime': 'Runtime',
  'review.pending': 'To review', 'review.approved': 'Approved', 'review.rejected': 'Sent back', 'review.exempt': 'No review',
  lines: 'lines', current: 'current', reasonText: 'Text is compared line by line', reasonHtml: 'Web prototypes can only sit side by side',
  'tech.title': 'Title', 'tech.lines': 'Lines', 'tech.words': 'Words', 'tech.targetWidth': 'Target width', 'tech.targetHeight': 'Target height', 'tech.targetDepth': 'Target depth'
}

const JA: Record<Key, string> = {
  intro: 'Markdown、Web プロトタイプ、JSON をそのまま表示できます。',
  display: '表示方法', typeset: '整形表示', raw: '原文', tree: 'ツリー', run: '実行', source: 'ソース',
  viewport: 'ビューポート', 'vp.fit': '全体表示', 'vp.phone': 'スマートフォン', 'vp.tablet': 'タブレット', 'vp.desktop': 'デスクトップ', viewerError: 'ビューアでエラーが発生しました',
  targetSize: '目標サイズ', missingTarget: '参照先のファイルが見つかりません',
  'stage.reference': '参考', 'stage.production': '制作', 'stage.runtime': 'ランタイム',
  'review.pending': 'レビュー待ち', 'review.approved': '承認', 'review.rejected': '差し戻し', 'review.exempt': 'レビュー不要',
  lines: '行', current: '現在', reasonText: 'テキストは行ごとに差分を表示します', reasonHtml: 'Web プロトタイプは並べて表示することしかできません',
  'tech.title': 'タイトル', 'tech.lines': '行数', 'tech.words': '単語数', 'tech.targetWidth': '目標の幅', 'tech.targetHeight': '目標の高さ', 'tech.targetDepth': '目標の奥行き'
}

const KO: Record<Key, string> = {
  intro: 'Markdown, 웹 프로토타입, JSON을 바로 볼 수 있어요.',
  display: '표시 방식', typeset: '서식 보기', raw: '원문', tree: '트리', run: '실행', source: '소스',
  viewport: '뷰포트', 'vp.fit': '맞춤', 'vp.phone': '휴대폰', 'vp.tablet': '태블릿', 'vp.desktop': '데스크톱', viewerError: '뷰어에 오류가 생겼어요',
  targetSize: '목표 크기', missingTarget: '가리키는 파일을 찾을 수 없어요',
  'stage.reference': '참고', 'stage.production': '제작', 'stage.runtime': '런타임',
  'review.pending': '검토 대기', 'review.approved': '승인', 'review.rejected': '반려', 'review.exempt': '검토 제외',
  lines: '줄', current: '현재', reasonText: '텍스트는 줄 단위로 차이를 보여 줘요', reasonHtml: '웹 프로토타입은 나란히 보기만 할 수 있어요',
  'tech.title': '제목', 'tech.lines': '줄 수', 'tech.words': '단어 수', 'tech.targetWidth': '목표 너비', 'tech.targetHeight': '목표 높이', 'tech.targetDepth': '목표 깊이'
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
