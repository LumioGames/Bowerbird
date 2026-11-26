/**
 * The model plugin's own strings in every shell language, on the SDK helper (ADR-061). Components read the shell's
 * language (`useT`); plain functions the shell calls outside React (compareModes, techLabels, render failures,
 * formatBadge, the size check) read the page language (`t`) or are handed one. Chinese follows design/docs/copy.md;
 * a language the dictionaries do not have yet falls back to English, then Chinese.
 */
import { defineMessages, pageLocale, translate as lookUp, useMessages, type Locale } from '@bowerbird/plugin-sdk/web'

const ZH = {
  // the new-file hint (FormatView.intro, ADR-064)
  intro: '能看通道、分屏，还能和四视图对照。',
  // channels (builtin-plugins.md「通道」)
  'ch.full': '完整渲染', 'ch.base': '基础色', 'ch.normal': '法线', 'ch.rough': '粗糙度', 'ch.metal': '金属度', 'ch.ao': '环境光遮蔽',
  'ch.emit': '自发光', 'ch.alpha': '透明度', 'ch.vcol': '顶点色', 'ch.wire': '线框', 'ch.wireover': '线框叠加', 'ch.uv': 'UV 棋盘格',
  'ch.matcap': 'Matcap', 'ch.face': '面朝向', 'ch.density': '贴图密度',
  compAll: '全部', menuMaterial: '材质通道', menuChecks: '检查视图', none: '无', channel: '通道',
  // compare (copy.md「四视图」)
  whyModel: '模型只能并排或卷帘', whyNoGrid: '这张图没有格子信息，只能与模型并排', whyNoDiff: '模型对照四视图不做像素差异',
  'view.front': '正', 'view.side': '侧', 'view.back': '背', 'view.top': '顶', persp: '透视', ortho: '正交',
  'view.frontOrtho': '正视图（正交）', 'view.sideOrtho': '侧视图（正交）', 'view.backOrtho': '背视图（正交）', 'view.topOrtho': '顶视图（正交）',
  'cube.z': '正视图', 'cube.-z': '后视图', 'cube.x': '右视图', 'cube.-x': '左视图', 'cube.y': '顶视图', 'cube.-y': '底视图',
  'axis.w': '宽', 'axis.h': '高', 'axis.d': '深', same: '一致', mismatch: '不符',
  sheet: '四视图', model: '模型', aspect: '宽高比', size: '尺寸', target: '目标', shouldBe: '应为 {v}',
  impliedTitle: '{axis}：按正视图的比例量出 {measured} m，设计对象写的是 {target} m',
  align: '对齐', alignMode: '对齐方式', byHeight: '按高度', byWidth: '按宽度', modelOpacity: '模型的不透明度', imageUnreadable: '图片读不出来',
  current: '当前', views: '视图', linkTitle: '选视图时，图片跟着定位到同一个视图', zoomOut: '缩小', zoomIn: '放大', fit: '适应', fitTitle: '适应 · 双击画面',
  // technical information
  'tech.triangles': '三角面', 'tech.vertices': '顶点', 'tech.meshes': '网格', 'tech.materials': '材质', 'tech.textures': '贴图',
  'tech.maxTextureSize': '最大贴图边长', 'tech.bones': '骨骼', 'tech.animations': '动画', 'tech.boundsX': '包围盒 宽（X）',
  'tech.boundsY': '包围盒 高（Y）', 'tech.boundsZ': '包围盒 深（Z）', 'tech.hasUV': 'UV', 'tech.hasNormals': '法线', 'tech.hasVertexColors': '顶点色', 'tech.vertexColorSets': '顶点色组数',
  'tech.row.textures': '{n} 张 · 最大 {size}', 'tech.row.anim': '{n} 段 · {names}', 'tech.row.animN': '{n} 段', 'tech.row.none': '无', 'tech.row.sep': '、',
  bounds: '包围盒', uvNormals: 'UV · 法线', yes: '有', no: '无', vcolSets: '{n} 组 · R G B A', listSep: '、',
  // environments
  'env.studio': '工作室', 'env.sunset': '日落', 'env.overcast': '阴天', 'env.night': '夜晚',
  // texture uses
  'role.base': '基础色', 'role.normal': '法线', 'role.bump': '凹凸', 'role.emit': '自发光', 'role.ao': '遮蔽', 'role.rough': '粗糙',
  'role.metal': '金属', 'role.mr': '粗糙 · 金属', 'role.orm': '遮蔽 · 粗糙 · 金属', 'role.alpha': '透明度', 'role.spec': '高光',
  imageN: '图像 {n}', textureGeneric: '贴图', meshN: '网格 {n}', materialN: '材质 {n}', clipN: '动画 {n}',
  // loading and failures
  notModel: '不是模型文件：{name}', missingNote: '缺少 {name}', missingBefore: '缺少', missingMore: ' 等 {n} 个', viewProblem: '查看问题',
  fbxArrays: 'FBX 里的数组与它声明的大小不符',
  draco: '这个模型的网格用 Draco 压缩过，当前版本还显示不了',
  ktx2: '这个模型的贴图是 KTX2 格式，当前版本还显示不了',
  noWebgl: '这台电脑的浏览器没有可用的 WebGL，显示不了 3D 模型',
  noWebglHint: '在浏览器设置里打开硬件加速，或换一台电脑打开这一页',
  loadFailed: '模型加载失败', decodeFailed: '这个模型无法解码', unsupportedModel: '当前版本显示不了这个模型',
  retry: '重试', download: '下载原文件', retryStillLoad: '重试后仍然无法显示', retryStillDecode: '重试后仍然无法解码',
  generatingThumb: '正在生成缩略图',
  // viewer
  splitMode: '对比方式', single: '单视图', wipe: '卷帘', strips: '多通道斜切', projection: '投影', frame: '复位视图', turntable: '转台',
  dimsTitle: '尺寸：包围盒与比例尺', output: '出图', setThumb: '把当前画面设为缩略图', saveImage: '另存为图片资产…', viewOptions: '查看选项',
  noVcol: '无顶点色', viewCube: '视图方向', scaleTitle: '比例尺（模型中心所在深度）',
  hdrFailed: '无法读取这个 HDR 文件', thumbSet: '已把当前画面设为缩略图', thumbFailed: '设为缩略图失败',
  removeStrip: '移除这一路', dragDivider: '拖动分界线', rotateDivider: '拖动旋转分界线，双击复位', addStrip: '增加一路',
  play: '播放', pause: '暂停', playKey: '播放 空格', timeline: '时间轴', loop: '循环', clip: '动画片段',
  // panel (「查看选项」)
  secEnv: '环境', library: '资产库', noHdr: '资产库里没有 HDR 文件', rotate: '旋转', rotateEnv: '旋转环境', exposure: '曝光', tone: '色调', toneMapping: '色调映射',
  toneNeutral: '中性', background: '背景', bgEnv: '环境', bgColor: '纯色', bgNone: '透明', color: '颜色', bgColorPick: '背景颜色',
  secLight: '灯光', keyLight: '主光', shadow: '阴影', lightDir: '主光方向', lightDirValue: '方位 {az}° · 高度 {el}°', dragLight: '拖动调整主光方向',
  secCamera: '相机与展示', fov: '视野角', ground: '地面', grid: '网格', dims: '尺寸',
  secStructure: '结构', showName: '显示{name}', hideName: '隐藏{name}', show: '显示', hide: '隐藏', solo: '单独查看', materialsCount: '{n} 个材质', skeleton: '骨骼',
  secAnimation: '动作', seconds: '{s} 秒', speed: '速度', secInfo: '信息', missing: '缺失',
  // save as image (builtin-plugins.md「出图」)
  toolName: 'Bowerbird 模型查看器', roleModel: '模型', saved: '已保存 {name}，来源指向 {model}', open: '查看', saveFailed: '保存失败',
  saveAsImage: '另存为图片资产', name: '名称', location: '位置', shotSize: '尺寸', transparentBg: '透明背景', cancel: '取消', save: '保存',
  // the grid badge (written by the server part as「2,480 面」) and the size check (ADR-020) in the shell's language
  badge: '{n} 面', checkLabel: '尺寸与设计对象', checkModel: '模型 {x} × {y} × {z} m', checkTarget: '目标 {w} × {h} × {d} m',
  checkAxis: '{axis} {model} m，应为 {target}', checkAxisSep: '；'
} as const
export type Key = keyof typeof ZH

const EN: Record<Key, string> = {
  intro: 'View its channels, split the view, and check it against a turnaround sheet.',
  'ch.full': 'Full render', 'ch.base': 'Base color', 'ch.normal': 'Normal', 'ch.rough': 'Roughness', 'ch.metal': 'Metalness', 'ch.ao': 'Ambient occlusion',
  'ch.emit': 'Emissive', 'ch.alpha': 'Opacity', 'ch.vcol': 'Vertex color', 'ch.wire': 'Wireframe', 'ch.wireover': 'Wireframe overlay', 'ch.uv': 'UV checker',
  'ch.matcap': 'Matcap', 'ch.face': 'Face orientation', 'ch.density': 'Texel density',
  compAll: 'All', menuMaterial: 'Material channels', menuChecks: 'Inspection views', none: 'None', channel: 'Channel',
  whyModel: 'Models can only be compared side by side or with the wipe', whyNoGrid: 'This image has no grid, so it can only be shown side by side with the model',
  whyNoDiff: 'A model against a turnaround sheet has no pixel difference',
  'view.front': 'Front', 'view.side': 'Side', 'view.back': 'Back', 'view.top': 'Top', persp: 'Perspective', ortho: 'Orthographic',
  'view.frontOrtho': 'Front view (orthographic)', 'view.sideOrtho': 'Side view (orthographic)', 'view.backOrtho': 'Back view (orthographic)', 'view.topOrtho': 'Top view (orthographic)',
  'cube.z': 'Front view', 'cube.-z': 'Back view', 'cube.x': 'Right view', 'cube.-x': 'Left view', 'cube.y': 'Top view', 'cube.-y': 'Bottom view',
  'axis.w': 'Width', 'axis.h': 'Height', 'axis.d': 'Depth', same: 'Match', mismatch: 'Off',
  sheet: 'Sheet', model: 'Model', aspect: 'Aspect', size: 'Size', target: 'Target', shouldBe: 'should be {v}',
  impliedTitle: "{axis}: {measured} m at the front view's scale; the design object says {target} m",
  align: 'Align', alignMode: 'Alignment', byHeight: 'By height', byWidth: 'By width', modelOpacity: 'Model opacity', imageUnreadable: 'The image could not be read',
  current: 'current', views: 'Views', linkTitle: 'Picking a view frames the same view on the image', zoomOut: 'Zoom out', zoomIn: 'Zoom in', fit: 'Fit', fitTitle: 'Fit · double-click the picture',
  'tech.triangles': 'Triangles', 'tech.vertices': 'Vertices', 'tech.meshes': 'Meshes', 'tech.materials': 'Materials', 'tech.textures': 'Textures',
  'tech.maxTextureSize': 'Largest texture', 'tech.bones': 'Bones', 'tech.animations': 'Animations', 'tech.boundsX': 'Bounds width (X)',
  'tech.boundsY': 'Bounds height (Y)', 'tech.boundsZ': 'Bounds depth (Z)', 'tech.hasUV': 'UV', 'tech.hasNormals': 'Normals', 'tech.hasVertexColors': 'Vertex colors', 'tech.vertexColorSets': 'Vertex color sets',
  'tech.row.textures': '{n} · up to {size}', 'tech.row.anim': '{n} · {names}', 'tech.row.animN': '{n}', 'tech.row.none': 'None', 'tech.row.sep': ', ',
  bounds: 'Bounds', uvNormals: 'UV · normals', yes: 'Yes', no: 'No', vcolSets: '{n} sets · R G B A', listSep: ', ',
  'env.studio': 'Studio', 'env.sunset': 'Sunset', 'env.overcast': 'Overcast', 'env.night': 'Night',
  'role.base': 'Base color', 'role.normal': 'Normal', 'role.bump': 'Bump', 'role.emit': 'Emissive', 'role.ao': 'Occlusion', 'role.rough': 'Roughness',
  'role.metal': 'Metalness', 'role.mr': 'Roughness · metalness', 'role.orm': 'Occlusion · roughness · metalness', 'role.alpha': 'Opacity', 'role.spec': 'Specular',
  imageN: 'Image {n}', textureGeneric: 'Texture', meshN: 'Mesh {n}', materialN: 'Material {n}', clipN: 'Animation {n}',
  notModel: 'Not a model file: {name}', missingNote: 'Missing {name}', missingBefore: 'Missing', missingMore: ' and {n} more', viewProblem: 'View issue',
  fbxArrays: 'An array in this FBX does not match the size it declares',
  draco: "This model's meshes are Draco-compressed, which this version cannot display yet",
  ktx2: "This model's textures are KTX2, which this version cannot display yet",
  noWebgl: "This computer's browser has no WebGL available, so 3D models cannot be shown",
  noWebglHint: 'Turn on hardware acceleration in the browser settings, or open this page on another computer',
  loadFailed: 'The model could not be loaded', decodeFailed: 'This model could not be decoded', unsupportedModel: 'This version cannot display this model',
  retry: 'Retry', download: 'Download original', retryStillLoad: 'Still cannot show it after retrying', retryStillDecode: 'Still cannot decode it after retrying',
  generatingThumb: 'Generating thumbnail',
  splitMode: 'Split', single: 'Single view', wipe: 'Wipe', strips: 'Slanted strips', projection: 'Projection', frame: 'Reset view', turntable: 'Turntable',
  dimsTitle: 'Size: bounds and scale bar', output: 'Output', setThumb: 'Use this view as the thumbnail', saveImage: 'Save as image asset…', viewOptions: 'View options',
  noVcol: 'No vertex colors', viewCube: 'View direction', scaleTitle: "Scale bar (at the model centre's depth)",
  hdrFailed: 'Could not read this HDR file', thumbSet: 'This view is now the thumbnail', thumbFailed: 'Could not set the thumbnail',
  removeStrip: 'Remove this strip', dragDivider: 'Drag the divider', rotateDivider: 'Drag to turn the divider, double-click to straighten', addStrip: 'Add a strip',
  play: 'Play', pause: 'Pause', playKey: 'Play  Space', timeline: 'Timeline', loop: 'Loop', clip: 'Animation clip',
  secEnv: 'Environment', library: 'Library', noHdr: 'No HDR files in the library', rotate: 'Rotation', rotateEnv: 'Rotate environment', exposure: 'Exposure', tone: 'Tone', toneMapping: 'Tone mapping',
  toneNeutral: 'Neutral', background: 'Background', bgEnv: 'Environment', bgColor: 'Color', bgNone: 'Transparent', color: 'Color', bgColorPick: 'Background color',
  secLight: 'Light', keyLight: 'Key light', shadow: 'Shadow', lightDir: 'Key light direction', lightDirValue: 'Azimuth {az}° · elevation {el}°', dragLight: 'Drag to change the key light direction',
  secCamera: 'Camera and display', fov: 'Field of view', ground: 'Ground', grid: 'Grid', dims: 'Size',
  secStructure: 'Structure', showName: 'Show {name}', hideName: 'Hide {name}', show: 'Show', hide: 'Hide', solo: 'Show only this', materialsCount: '{n} materials', skeleton: 'Skeleton',
  secAnimation: 'Animation', seconds: '{s} s', speed: 'Speed', secInfo: 'Info', missing: 'Missing',
  toolName: 'Bowerbird model viewer', roleModel: 'model', saved: 'Saved {name}, with {model} as its source', open: 'Open', saveFailed: 'Could not save',
  saveAsImage: 'Save as image asset', name: 'Name', location: 'Location', shotSize: 'Size', transparentBg: 'Transparent background', cancel: 'Cancel', save: 'Save',
  badge: '{n} tris', checkLabel: 'Size vs design object', checkModel: 'Model {x} × {y} × {z} m', checkTarget: 'Target {w} × {h} × {d} m',
  checkAxis: '{axis} {model} m, should be {target}', checkAxisSep: '; '
}

const JA: Record<Key, string> = {
  intro: 'チャンネル表示や画面分割ができ、四面図と照らし合わせることもできます。',
  'ch.full': 'フルレンダー', 'ch.base': 'ベースカラー', 'ch.normal': '法線', 'ch.rough': '粗さ', 'ch.metal': 'メタリック', 'ch.ao': 'アンビエントオクルージョン',
  'ch.emit': 'エミッション', 'ch.alpha': '不透明度', 'ch.vcol': '頂点カラー', 'ch.wire': 'ワイヤーフレーム', 'ch.wireover': 'ワイヤーフレーム重ね表示', 'ch.uv': 'UV チェッカー',
  'ch.matcap': 'Matcap', 'ch.face': '面の向き', 'ch.density': 'テクセル密度',
  compAll: 'すべて', menuMaterial: 'マテリアルチャンネル', menuChecks: 'チェック表示', none: 'なし', channel: 'チャンネル',
  whyModel: 'モデルは並べて表示するかワイプで比較することしかできません', whyNoGrid: 'この画像にはグリッド情報がないため、モデルと並べて表示することしかできません',
  whyNoDiff: 'モデルと四面図ではピクセル差分は表示しません',
  'view.front': '正面', 'view.side': '側面', 'view.back': '背面', 'view.top': '上面', persp: '透視投影', ortho: '平行投影',
  'view.frontOrtho': '正面図（平行投影）', 'view.sideOrtho': '側面図（平行投影）', 'view.backOrtho': '背面図（平行投影）', 'view.topOrtho': '上面図（平行投影）',
  'cube.z': '正面図', 'cube.-z': '背面図', 'cube.x': '右側面図', 'cube.-x': '左側面図', 'cube.y': '上面図', 'cube.-y': '底面図',
  'axis.w': '幅', 'axis.h': '高さ', 'axis.d': '奥行き', same: '一致', mismatch: '不一致',
  sheet: '四面図', model: 'モデル', aspect: '縦横比', size: 'サイズ', target: '目標', shouldBe: '正しくは {v}',
  impliedTitle: '{axis}：正面図の縮尺で測ると {measured} m、デザイン対象では {target} m です',
  align: '位置合わせ', alignMode: '位置合わせの方法', byHeight: '高さで合わせる', byWidth: '幅で合わせる', modelOpacity: 'モデルの不透明度', imageUnreadable: '画像を読み込めません',
  current: '現在', views: 'ビュー', linkTitle: 'ビューを選ぶと、画像も同じビューに移動します', zoomOut: '縮小', zoomIn: '拡大', fit: '全体表示', fitTitle: '全体表示 · 画面をダブルクリック',
  'tech.triangles': '三角ポリゴン', 'tech.vertices': '頂点', 'tech.meshes': 'メッシュ', 'tech.materials': 'マテリアル', 'tech.textures': 'テクスチャ',
  'tech.maxTextureSize': 'テクスチャの最大辺', 'tech.bones': 'ボーン', 'tech.animations': 'アニメーション', 'tech.boundsX': 'バウンディングボックス 幅（X）',
  'tech.boundsY': 'バウンディングボックス 高さ（Y）', 'tech.boundsZ': 'バウンディングボックス 奥行き（Z）', 'tech.hasUV': 'UV', 'tech.hasNormals': '法線', 'tech.hasVertexColors': '頂点カラー', 'tech.vertexColorSets': '頂点カラーのセット数',
  'tech.row.textures': '{n} 枚 · 最大 {size}', 'tech.row.anim': '{n} 個 · {names}', 'tech.row.animN': '{n} 個', 'tech.row.none': 'なし', 'tech.row.sep': '、',
  bounds: 'バウンディングボックス', uvNormals: 'UV · 法線', yes: 'あり', no: 'なし', vcolSets: '{n} セット · R G B A', listSep: '、',
  'env.studio': 'スタジオ', 'env.sunset': '夕暮れ', 'env.overcast': '曇り', 'env.night': '夜',
  'role.base': 'ベースカラー', 'role.normal': '法線', 'role.bump': 'バンプ', 'role.emit': 'エミッション', 'role.ao': 'オクルージョン', 'role.rough': '粗さ',
  'role.metal': 'メタリック', 'role.mr': '粗さ · メタリック', 'role.orm': 'オクルージョン · 粗さ · メタリック', 'role.alpha': '不透明度', 'role.spec': 'スペキュラー',
  imageN: '画像 {n}', textureGeneric: 'テクスチャ', meshN: 'メッシュ {n}', materialN: 'マテリアル {n}', clipN: 'アニメーション {n}',
  notModel: 'モデルファイルではありません：{name}', missingNote: '{name} が見つかりません', missingBefore: '見つからないファイル：', missingMore: ' ほか {n} 個', viewProblem: '問題を表示',
  fbxArrays: 'FBX 内の配列が宣言されたサイズと一致しません',
  draco: 'このモデルのメッシュは Draco で圧縮されているため、このバージョンではまだ表示できません',
  ktx2: 'このモデルのテクスチャは KTX2 形式のため、このバージョンではまだ表示できません',
  noWebgl: 'このコンピュータのブラウザでは WebGL が使えないため、3D モデルを表示できません',
  noWebglHint: 'ブラウザの設定でハードウェアアクセラレーションをオンにするか、別のコンピュータでこのページを開いてください',
  loadFailed: 'モデルを読み込めませんでした', decodeFailed: 'このモデルはデコードできません', unsupportedModel: 'このバージョンではこのモデルを表示できません',
  retry: '再試行', download: '元ファイルをダウンロード', retryStillLoad: '再試行しても表示できませんでした', retryStillDecode: '再試行してもデコードできませんでした',
  generatingThumb: 'サムネイルを生成しています',
  splitMode: '比較方法', single: 'シングルビュー', wipe: 'ワイプ', strips: 'マルチチャンネル斜め分割', projection: '投影', frame: 'ビューをリセット', turntable: 'ターンテーブル',
  dimsTitle: 'サイズ：バウンディングボックスとスケールバー', output: '画像出力', setThumb: '現在の画面をサムネイルにする', saveImage: '画像アセットとして保存…', viewOptions: '表示オプション',
  noVcol: '頂点カラーなし', viewCube: '視点の方向', scaleTitle: 'スケールバー（モデル中心の奥行き）',
  hdrFailed: 'この HDR ファイルを読み込めません', thumbSet: '現在の画面をサムネイルにしました', thumbFailed: 'サムネイルに設定できませんでした',
  removeStrip: 'この分割を削除', dragDivider: '境界線をドラッグ', rotateDivider: 'ドラッグで境界線を回転、ダブルクリックで元に戻す', addStrip: '分割を追加',
  play: '再生', pause: '一時停止', playKey: '再生  スペース', timeline: 'タイムライン', loop: 'ループ', clip: 'アニメーションクリップ',
  secEnv: '環境', library: 'ライブラリ', noHdr: 'ライブラリに HDR ファイルがありません', rotate: '回転', rotateEnv: '環境の回転', exposure: '露出', tone: 'トーン', toneMapping: 'トーンマッピング',
  toneNeutral: 'ニュートラル', background: '背景', bgEnv: '環境', bgColor: '単色', bgNone: '透明', color: '色', bgColorPick: '背景色',
  secLight: 'ライト', keyLight: 'キーライト', shadow: '影', lightDir: 'キーライトの方向', lightDirValue: '方位 {az}° · 高度 {el}°', dragLight: 'ドラッグしてキーライトの方向を調整',
  secCamera: 'カメラと表示', fov: '視野角', ground: '地面', grid: 'グリッド', dims: 'サイズ',
  secStructure: '構造', showName: '{name}を表示', hideName: '{name}を非表示', show: '表示', hide: '非表示', solo: 'これだけを表示', materialsCount: 'マテリアル {n} 個', skeleton: 'スケルトン',
  secAnimation: 'アニメーション', seconds: '{s} 秒', speed: '速度', secInfo: '情報', missing: '欠落',
  toolName: 'Bowerbird モデルビューア', roleModel: 'モデル', saved: '{name} を保存しました。ソースは {model} です', open: '表示', saveFailed: '保存できませんでした',
  saveAsImage: '画像アセットとして保存', name: '名前', location: '保存先', shotSize: 'サイズ', transparentBg: '透明な背景', cancel: 'キャンセル', save: '保存',
  badge: '{n} ポリゴン', checkLabel: 'サイズとデザイン対象', checkModel: 'モデル {x} × {y} × {z} m', checkTarget: '目標 {w} × {h} × {d} m',
  checkAxis: '{axis} {model} m（正しくは {target}）', checkAxisSep: '、'
}

const KO: Record<Key, string> = {
  intro: '채널을 보고 화면을 나눠 볼 수 있고, 4면도와 맞춰 볼 수도 있어요.',
  'ch.full': '전체 렌더', 'ch.base': '베이스 컬러', 'ch.normal': '노멀', 'ch.rough': '거칠기', 'ch.metal': '메탈릭', 'ch.ao': '앰비언트 오클루전',
  'ch.emit': '이미션', 'ch.alpha': '불투명도', 'ch.vcol': '버텍스 컬러', 'ch.wire': '와이어프레임', 'ch.wireover': '와이어프레임 오버레이', 'ch.uv': 'UV 체커',
  'ch.matcap': 'Matcap', 'ch.face': '면 방향', 'ch.density': '텍셀 밀도',
  compAll: '전체', menuMaterial: '재질 채널', menuChecks: '검사 보기', none: '없음', channel: '채널',
  whyModel: '모델은 나란히 보기나 와이프로만 비교할 수 있어요', whyNoGrid: '이 이미지에는 격자 정보가 없어서 모델과 나란히 보기만 할 수 있어요',
  whyNoDiff: '모델과 4면도는 픽셀 차이를 비교하지 않아요',
  'view.front': '정면', 'view.side': '측면', 'view.back': '후면', 'view.top': '윗면', persp: '원근', ortho: '직교',
  'view.frontOrtho': '정면도(직교)', 'view.sideOrtho': '측면도(직교)', 'view.backOrtho': '후면도(직교)', 'view.topOrtho': '평면도(직교)',
  'cube.z': '정면도', 'cube.-z': '배면도', 'cube.x': '우측면도', 'cube.-x': '좌측면도', 'cube.y': '평면도', 'cube.-y': '저면도',
  'axis.w': '너비', 'axis.h': '높이', 'axis.d': '깊이', same: '일치', mismatch: '불일치',
  sheet: '4면도', model: '모델', aspect: '종횡비', size: '크기', target: '목표', shouldBe: '기준 {v}',
  impliedTitle: '{axis}: 정면도 비율로 재면 {measured} m이고, 디자인 대상에는 {target} m로 적혀 있어요',
  align: '정렬', alignMode: '정렬 방식', byHeight: '높이 기준', byWidth: '너비 기준', modelOpacity: '모델 불투명도', imageUnreadable: '이미지를 읽을 수 없어요',
  current: '현재', views: '뷰', linkTitle: '뷰를 고르면 이미지도 같은 뷰로 이동해요', zoomOut: '축소', zoomIn: '확대', fit: '맞춤', fitTitle: '맞춤 · 화면 더블 클릭',
  'tech.triangles': '삼각면', 'tech.vertices': '버텍스', 'tech.meshes': '메시', 'tech.materials': '재질', 'tech.textures': '텍스처',
  'tech.maxTextureSize': '최대 텍스처 크기', 'tech.bones': '본', 'tech.animations': '애니메이션', 'tech.boundsX': '바운딩 박스 너비(X)',
  'tech.boundsY': '바운딩 박스 높이(Y)', 'tech.boundsZ': '바운딩 박스 깊이(Z)', 'tech.hasUV': 'UV', 'tech.hasNormals': '노멀', 'tech.hasVertexColors': '버텍스 컬러', 'tech.vertexColorSets': '버텍스 컬러 세트 수',
  'tech.row.textures': '{n}장 · 최대 {size}', 'tech.row.anim': '{n}개 · {names}', 'tech.row.animN': '{n}개', 'tech.row.none': '없음', 'tech.row.sep': ', ',
  bounds: '바운딩 박스', uvNormals: 'UV · 노멀', yes: '있음', no: '없음', vcolSets: '{n}세트 · R G B A', listSep: ', ',
  'env.studio': '스튜디오', 'env.sunset': '노을', 'env.overcast': '흐림', 'env.night': '밤',
  'role.base': '베이스 컬러', 'role.normal': '노멀', 'role.bump': '범프', 'role.emit': '이미션', 'role.ao': '오클루전', 'role.rough': '거칠기',
  'role.metal': '메탈릭', 'role.mr': '거칠기 · 메탈릭', 'role.orm': '오클루전 · 거칠기 · 메탈릭', 'role.alpha': '불투명도', 'role.spec': '스페큘러',
  imageN: '이미지 {n}', textureGeneric: '텍스처', meshN: '메시 {n}', materialN: '재질 {n}', clipN: '애니메이션 {n}',
  notModel: '모델 파일이 아니에요: {name}', missingNote: '{name}을(를) 찾을 수 없어요', missingBefore: '없는 파일:', missingMore: ' 외 {n}개', viewProblem: '문제 보기',
  fbxArrays: 'FBX 안의 배열이 선언된 크기와 맞지 않아요',
  draco: '이 모델의 메시는 Draco로 압축되어 있어서 이 버전에서는 아직 표시할 수 없어요',
  ktx2: '이 모델의 텍스처는 KTX2 형식이라 이 버전에서는 아직 표시할 수 없어요',
  noWebgl: '이 컴퓨터의 브라우저에서 WebGL을 사용할 수 없어서 3D 모델을 표시할 수 없어요',
  noWebglHint: '브라우저 설정에서 하드웨어 가속을 켜거나 다른 컴퓨터에서 이 페이지를 열어 주세요',
  loadFailed: '모델을 불러오지 못했어요', decodeFailed: '이 모델은 디코딩할 수 없어요', unsupportedModel: '이 버전에서는 이 모델을 표시할 수 없어요',
  retry: '다시 시도', download: '원본 파일 다운로드', retryStillLoad: '다시 시도해도 표시할 수 없어요', retryStillDecode: '다시 시도해도 디코딩할 수 없어요',
  generatingThumb: '썸네일을 만드는 중이에요',
  splitMode: '비교 방식', single: '단일 뷰', wipe: '와이프', strips: '다중 채널 사선 분할', projection: '투영', frame: '뷰 초기화', turntable: '턴테이블',
  dimsTitle: '크기: 바운딩 박스와 축척 막대', output: '이미지 출력', setThumb: '현재 화면을 썸네일로 지정', saveImage: '이미지 에셋으로 저장…', viewOptions: '보기 옵션',
  noVcol: '버텍스 컬러 없음', viewCube: '뷰 방향', scaleTitle: '축척 막대(모델 중심 깊이 기준)',
  hdrFailed: '이 HDR 파일을 읽을 수 없어요', thumbSet: '현재 화면을 썸네일로 지정했어요', thumbFailed: '썸네일로 지정하지 못했어요',
  removeStrip: '이 분할 삭제', dragDivider: '경계선 드래그', rotateDivider: '드래그해서 경계선 회전, 더블 클릭하면 초기화', addStrip: '분할 추가',
  play: '재생', pause: '일시정지', playKey: '재생  Space', timeline: '타임라인', loop: '반복', clip: '애니메이션 클립',
  secEnv: '환경', library: '라이브러리', noHdr: '라이브러리에 HDR 파일이 없어요', rotate: '회전', rotateEnv: '환경 회전', exposure: '노출', tone: '톤', toneMapping: '톤 매핑',
  toneNeutral: '뉴트럴', background: '배경', bgEnv: '환경', bgColor: '단색', bgNone: '투명', color: '색', bgColorPick: '배경색',
  secLight: '조명', keyLight: '키 라이트', shadow: '그림자', lightDir: '키 라이트 방향', lightDirValue: '방위 {az}° · 고도 {el}°', dragLight: '드래그해서 키 라이트 방향 조정',
  secCamera: '카메라와 표시', fov: '시야각', ground: '바닥', grid: '그리드', dims: '크기',
  secStructure: '구조', showName: '{name} 표시', hideName: '{name} 숨기기', show: '표시', hide: '숨기기', solo: '이것만 보기', materialsCount: '재질 {n}개', skeleton: '스켈레톤',
  secAnimation: '애니메이션', seconds: '{s}초', speed: '속도', secInfo: '정보', missing: '누락',
  toolName: 'Bowerbird 모델 뷰어', roleModel: '모델', saved: '{name}을(를) 저장했어요. 소스는 {model}이에요', open: '보기', saveFailed: '저장하지 못했어요',
  saveAsImage: '이미지 에셋으로 저장', name: '이름', location: '위치', shotSize: '크기', transparentBg: '투명 배경', cancel: '취소', save: '저장',
  badge: '{n} 삼각면', checkLabel: '크기와 디자인 대상', checkModel: '모델 {x} × {y} × {z} m', checkTarget: '목표 {w} × {h} × {d} m',
  checkAxis: '{axis} {model} m(기준 {target})', checkAxisSep: ', '
}

export const DICTS: Readonly<Record<Locale, Record<Key, string>>> = { 'zh-CN': ZH, en: EN, ja: JA, ko: KO }
export const messages = defineMessages(DICTS)

export type T = (key: Key, params?: Record<string, string | number>) => string

/** One string in a language (the language, then English, then Chinese). */
export function translate(locale: string, key: Key, params?: Record<string, string | number>): string { return lookUp(messages, locale, key, params) }

/** Translation outside components (the page language the shell set on `<html lang>`). */
export const t: T = (key, params) => translate(pageLocale(), key, params)
/** Chinese, the default of pure helpers called without a translator. */
export const zh: T = (key, params) => translate('zh-CN', key, params)
export const en: T = (key, params) => translate('en', key, params)
/** A translator for one language (functions the shell hands a language to). */
export const inLocale = (locale: string): T => (key, params) => translate(locale, key, params)

/** Translation in components (the shell's language; re-renders when it changes). */
export function useT(): T { return useMessages(messages) }
