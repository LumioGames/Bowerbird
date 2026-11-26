/** Calls to this plugin's own routes (`/plugins/community.forge/…`) and the strings the UI shows, in every shell language. */
import { defineMessages, translate, type ShellApi } from '@bowerbird/plugin-sdk/web'

export const PLUGIN_ID = 'community.forge'
export const NAME = 'Forge'

export type RunState = 'running' | 'pick' | 'done' | 'failed' | 'cancelled'
export interface RunView {
  job: string
  creator: 'image' | 'model'
  creatorName: string
  title: string
  state: RunState
  progress: number
  message: string
  params: Record<string, unknown>
  inputs: Array<{ role: string; id: string; name: string }>
  folder: string
  by: string
  startedAt: string
  error?: string
  /** Why it failed, when it is one of the simulated failures (`ENOENT`, `E503`). */
  errorCode?: string
  candidates: Array<{ index: number; name: string; kind: 'image' | 'model'; preview: string }>
  registered: Array<{ id: string; name: string; path: string }>
}
export interface Quota { used: number; quota: number; month: string }
export interface Status { tool: string | null; simulate: 'none' | 'missing-tool' | 'unavailable'; failures: number }

export function routeUrl(shell: ShellApi, path: string): string { return shell.api.plugins.routeUrl(PLUGIN_ID, path) }

export async function call<T>(shell: ShellApi, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(routeUrl(shell, path), {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-bowerbird-actor': shell.actor },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`)
  return data as T
}

const ZH = {
  tab: 'Forge', tabHeading: 'Forge 的这次生成', method: '方式', started: '发起', params: '参数', again: '用同样的设置再生成…',
  start: '开始', cancel: '取消', startedToast: '已开始{0}', viewJobs: '查看任务', prompt: '提示词',
  quotaTitle: 'Forge 本月额度', settings: 'Forge 设置', none: '还没有生成过', pick: '待挑选', failed: '失败', cancelled: '已取消',
  pickTitle: '挑选 · {0}', pickNote: '没选中的不进资产库，只在这台电脑上临时保留。', later: '稍后', keepN: '留下 {0} 个', atLeastOne: '至少选一个',
  registered: '已登记 {0}', registeredN: '{0} 个', gone: '这次生成已经结束，或候选已被清理',
  endpoint: '服务地址', apiKey: '访问密钥', defaultModel: '默认模型', outputFolder: '产出放到', currentFolder: '当前文件夹', tool: '外部工具',
  toolMissing: '没找到 forge-cli', simulate: '测试：模拟故障', simNone: '不模拟', simTool: '缺少外部工具', simDown: '服务没有响应（503）',
  library: '随资产库', machine: '只在本机', change: '更换…', fill: '填写…', save: '保存', saved: '已保存', candidate: '候选 {0}',
  creatorImage: 'AI 生图', creatorModel: '生成模型', by: '{0} 提供', runImage: '{0} · {1} 张', runModel: '{0} · {1} 个', running: '生成中 {0}%'
}
type Key = keyof typeof ZH

const EN: Record<Key, string> = {
  tab: 'Forge', tabHeading: 'This Forge run', method: 'Method', started: 'Started', params: 'Parameters', again: 'Generate again with these settings…',
  start: 'Start', cancel: 'Cancel', startedToast: 'Started {0}', viewJobs: 'View jobs', prompt: 'Prompt',
  quotaTitle: 'Forge usage this month', settings: 'Forge settings', none: 'Nothing generated yet', pick: 'To pick', failed: 'Failed', cancelled: 'Cancelled',
  pickTitle: 'Pick · {0}', pickNote: 'The ones you leave out stay out of the library, kept only on this computer for now.', later: 'Later', keepN: 'Keep {0}', atLeastOne: 'Pick at least one',
  registered: 'Registered {0}', registeredN: '{0} assets', gone: 'This run has ended, or its candidates were cleaned up',
  endpoint: 'Service URL', apiKey: 'Access key', defaultModel: 'Default model', outputFolder: 'Put outputs in', currentFolder: 'Current folder', tool: 'External tool',
  toolMissing: 'forge-cli not found', simulate: 'Test: simulate a failure', simNone: 'Off', simTool: 'Missing external tool', simDown: 'Service not responding (503)',
  library: 'With the library', machine: 'This computer only', change: 'Change…', fill: 'Enter…', save: 'Save', saved: 'Saved', candidate: 'Candidate {0}',
  creatorImage: 'AI image', creatorModel: 'Generate model', by: 'From {0}', runImage: '{0} · {1} images', runModel: '{0} · {1} models', running: 'Generating {0}%'
}

const JA: Record<Key, string> = {
  tab: 'Forge', tabHeading: 'この Forge の生成', method: '方式', started: '開始者', params: 'パラメータ', again: '同じ設定でもう一度生成…',
  start: '開始', cancel: 'キャンセル', startedToast: '{0}を開始しました', viewJobs: 'タスクを表示', prompt: 'プロンプト',
  quotaTitle: '今月の Forge 利用枠', settings: 'Forge の設定', none: 'まだ生成していません', pick: '選択待ち', failed: '失敗', cancelled: 'キャンセル済み',
  pickTitle: '選択 · {0}', pickNote: '選ばなかったものはライブラリに入らず、このコンピュータに一時的に残ります。', later: '後で', keepN: '{0} 個を残す', atLeastOne: '1 つ以上選んでください',
  registered: '{0} を登録しました', registeredN: '{0} 個', gone: 'この生成は終了したか、候補が削除されました',
  endpoint: 'サービスの URL', apiKey: 'アクセスキー', defaultModel: '既定のモデル', outputFolder: '出力先', currentFolder: '現在のフォルダ', tool: '外部ツール',
  toolMissing: 'forge-cli が見つかりません', simulate: 'テスト：障害をシミュレート', simNone: 'シミュレートしない', simTool: '外部ツールがない', simDown: 'サービスが応答しません（503）',
  library: 'ライブラリと共有', machine: 'このコンピュータのみ', change: '変更…', fill: '入力…', save: '保存', saved: '保存しました', candidate: '候補 {0}',
  creatorImage: 'AI 画像生成', creatorModel: 'モデルを生成', by: '提供：{0}', runImage: '{0} · {1} 枚', runModel: '{0} · {1} 個', running: '生成中 {0}%'
}

const KO: Record<Key, string> = {
  tab: 'Forge', tabHeading: '이번 Forge 생성', method: '방식', started: '시작', params: '매개변수', again: '같은 설정으로 다시 생성…',
  start: '시작', cancel: '취소', startedToast: '{0}을(를) 시작했어요', viewJobs: '작업 보기', prompt: '프롬프트',
  quotaTitle: '이번 달 Forge 사용량', settings: 'Forge 설정', none: '아직 생성한 적이 없어요', pick: '선택 대기', failed: '실패', cancelled: '취소됨',
  pickTitle: '선택 · {0}', pickNote: '선택하지 않은 것은 라이브러리에 들어가지 않고 이 컴퓨터에만 잠시 남아요.', later: '나중에', keepN: '{0}개 남기기', atLeastOne: '하나 이상 골라 주세요',
  registered: '{0}을(를) 등록했어요', registeredN: '{0}개', gone: '이번 생성은 끝났거나 후보가 정리됐어요',
  endpoint: '서비스 주소', apiKey: '액세스 키', defaultModel: '기본 모델', outputFolder: '결과물 위치', currentFolder: '현재 폴더', tool: '외부 도구',
  toolMissing: 'forge-cli를 찾을 수 없어요', simulate: '테스트: 장애 시뮬레이션', simNone: '시뮬레이션 안 함', simTool: '외부 도구 없음', simDown: '서비스가 응답하지 않아요(503)',
  library: '라이브러리에 저장', machine: '이 컴퓨터만', change: '변경…', fill: '입력…', save: '저장', saved: '저장했어요', candidate: '후보 {0}',
  creatorImage: 'AI 이미지 생성', creatorModel: '모델 생성', by: '{0} 제공', runImage: '{0} · {1}장', runModel: '{0} · {1}개', running: '생성 중 {0}%'
}

/** Forge's UI strings in every shell language (ADR-061); placeholders are positional: `{0}`, `{1}`. */
export const messages = defineMessages({ 'zh-CN': ZH, en: EN, ja: JA, ko: KO })
export type { Key }

export function tr(shell: Pick<ShellApi, 'locale'>, key: Key, ...args: Array<string | number>): string {
  return translate(messages, shell.locale, key, Object.fromEntries(args.map((a, i) => [String(i), a])))
}

/** A run's title in the UI language: its creation way and how many (the server's `title` is written in Chinese). */
export function runTitle(shell: Pick<ShellApi, 'locale'>, r: Pick<RunView, 'creator' | 'params'>): string {
  const n = Number(r.params.count ?? 1)
  return r.creator === 'model' ? tr(shell, 'runModel', tr(shell, 'creatorModel'), n) : tr(shell, 'runImage', tr(shell, 'creatorImage'), n)
}

/** What a run is doing, for its tooltip: its state or a known failure in the UI language, else what the server said. */
export function runNote(shell: Pick<ShellApi, 'locale'>, r: Pick<RunView, 'state' | 'progress' | 'message' | 'error' | 'errorCode'>): string {
  if (r.state === 'failed') return r.errorCode === 'ENOENT' ? tr(shell, 'simTool') : r.errorCode === 'E503' ? tr(shell, 'simDown') : (r.error ?? tr(shell, 'failed'))
  if (r.state === 'running') return tr(shell, 'running', Math.round(r.progress * 100))
  if (r.state === 'pick') return tr(shell, 'pick')
  if (r.state === 'cancelled') return tr(shell, 'cancelled')
  return r.message
}

/** Params as one line, the way the prototype's detail tab shows them. */
export function paramsLine(params: Record<string, unknown> | undefined): string {
  if (!params) return '—'
  return Object.entries(params).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k} ${String(v)}`).join(' · ')
}
