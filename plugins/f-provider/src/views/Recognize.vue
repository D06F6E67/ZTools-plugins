<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated, watch, nextTick } from "vue";
import { ZButton, ZTag, useToast, useColorScheme } from "ztools-ui";
import katex from "katex";
import "katex/dist/katex.min.css";
import EngineStatusCard from "../components/EngineStatusCard.vue";
import OcrImageViewer from "../components/OcrImageViewer.vue";
import { useNativeEngine } from "../composables/useNativeEngine";
import { useLatexEngine } from "../composables/useLatexEngine";
import { useSegmentIndicator } from "../composables/useSegmentIndicator";

/**
 * 识别子页（合并文字 OCR 与公式识别）：左右结构。
 *
 * 左侧：图片舞台（拖拽/粘贴/选图）。
 *   - 文字模式：复用 OcrImageViewer（canvas 绘图 + 透明文字层 + 全屏预览），
 *     通过 hideResult 隐藏其内置列表，改由右侧统一渲染。
 *   - 公式模式：普通 <img> 预览。
 * 右侧：结果面板。
 *   - 顶部：模式切换（文字 / 公式）+ 引擎状态标签 + 操作按钮。
 *   - 文字：识别行列表，与左侧图上文字双向高亮联动，点击复制。
 *   - 公式：KaTeX 渲染预览 + LaTeX 源码 + 三种复制形式。
 *
 * 切换模式时保留同一张图片与各自的识别结果（互不干扰），可对同一图片
 * 分别进行文字识别与公式识别。切换到某模式时自动触发一次识别；若该模式已
 * 有缓存结果则直接展示，不重复识别。引擎未就绪期间选图，模型下载完成后
 * 自动补识别当前模式。
 */

const props = withDefaults(
  defineProps<{
    /** 进入时预填的待识别图片（data URI 或本地 path）。 */
    initialImage?: string;
    /** 初始模式（由父组件根据入口 action.code 决定）。 */
    initialMode?: "text" | "formula";
    /**
     * 进入即自动截屏（screen-ocr / screen-latex feature）。
     * 为 true 时，组件挂载后引擎就绪即自动调系统截图；引擎未就绪则等下载完成后
     * 由 watcher 触发。截图结果留在本页展示，不再弹独立窗口。
     */
    autoCapture?: boolean;
  }>(),
  { initialImage: "", initialMode: "text", autoCapture: false },
);

// 响应式暗色标记：宿主切换主题时同步，用于避免 :global(html.dark) 在 scoped 下不生效。
const { isDark } = useColorScheme();

/**
 * 模式变化时上报父组件：公式模式下底部悬浮导航栏会移到左下角，
 * 避免遮挡右下角的三个复制按钮（见 SettingLayout 的 dockAlign）。
 * immediate：组件每次按 :key 重建时同步当前模式，保证 dock 位置正确。
 *
 * 识别成功后上抛 history 事件：由 Manage 统一写入历史记录单例（dbStorage），
 * 不在子组件内直接依赖 dbStorage。
 */
const emit = defineEmits<{
  (e: "mode-change", mode: "text" | "formula"): void;
  (e: "history", item: HistoryEmitItem): void;
}>();

const { success, error } = useToast();
const { nativeReady, checkNative } = useNativeEngine();
const { latexReady, checkLatex } = useLatexEngine();

// ─── 模式 ────────────────────────────────────────────────────────────
const mode = ref<"text" | "formula">(props.initialMode);

function switchMode(next: "text" | "formula") {
  if (mode.value === next) return;
  mode.value = next;
  // 切换后自动识别当前模式：若该模式已有缓存结果则直接展示（命中缓存不重识别），
  // 否则触发一次识别；引擎未就绪时静默跳过，由引擎引导卡引导下载，
  // 就绪后由 nativeReady/latexReady watcher 补识别。
  autoRecognize();
}

// 引擎就绪态按模式映射
const engineReady = computed(() =>
  mode.value === "text" ? nativeReady.value : latexReady.value,
);

// 模式切换条滑动高亮：文字=0、公式=1
const modeIndex = computed(() => (mode.value === "text" ? 0 : 1));
const {
  containerRef: modeSwitchRef,
  setItemRef: setModeItemRef,
  pos: modeIndicator,
  noAnim: modeNoAnim,
} = useSegmentIndicator(modeIndex);

// ─── 图片与识别状态 ──────────────────────────────────────────────────
// imageSrc 用于预览（data URI / URL）；recognizeSrc 才是真正传给识别服务的源。
const imageSrc = ref("");
const recognizeSrc = ref("");
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// 文字 OCR 结果
const ocrLoading = ref(false);
const ocrError = ref("");
const ocrLines = ref<OcrLine[]>([]);
const ocrDone = ref(false); // 标记是否已识别过（区分空结果与未识别）

// 公式识别结果
const latexLoading = ref(false);
const latexError = ref("");
const latex = ref("");
const latexDone = ref(false);

const loading = computed(() =>
  mode.value === "text" ? ocrLoading.value : latexLoading.value,
);
const errorText = computed(() =>
  mode.value === "text" ? ocrError.value : latexError.value,
);

// 文字模式：列表↔图上高亮联动的当前悬停索引（-1 表示无）
const hoveredIndex = ref(-1);
function onViewerHover(i: number) {
  hoveredIndex.value = i;
}

// 把 File 读成 data URL
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function pickImage() {
  fileInput.value?.click();
}

async function setImageFromFile(file: File) {
  if (!file.type.startsWith("image/")) {
    error("请选择图片文件");
    return;
  }
  const dataUrl = await readFileAsDataURL(file);
  setImage(dataUrl);
  autoRecognize();
}

/**
 * 设置新图片：清空两种模式的结果与 done 标记。
 * data URI / http(s) URL 直接展示；本地 path 经 preload 转 data URI 后展示。
 */
function setImage(src: string) {
  recognizeSrc.value = src;
  if (/^data:/i.test(src) || /^https?:\/\//i.test(src)) {
    imageSrc.value = src;
  } else {
    try {
      imageSrc.value = window.services.readFileAsDataURL(src);
    } catch {
      imageSrc.value = "";
    }
  }
  resetResults();
}

/**
 * 设置图片 / 切换模式后自动识别当前模式。
 * - 引擎未就绪时静默跳过（由引擎引导卡引导下载，就绪后由 watcher 补识别）。
 * - 当前模式若已识别过（*Done 为 true）则复用缓存结果，避免对同一张图片重复识别。
 */
function autoRecognize() {
  if (!recognizeSrc.value || !engineReady.value) return;
  if (mode.value === "text" && ocrDone.value) return;
  if (mode.value === "formula" && latexDone.value) return;
  nextTick(() => recognize());
}

/** 截图识别：调系统截图，截完设为图片并自动识别当前模式。 */
function captureScreen() {
  window.ztools.screenCapture((imgBase64: string) => {
    if (!imgBase64) return; // 用户取消截屏：留在本页，可手动操作
    const dataUri = imgBase64.startsWith("data:")
      ? imgBase64
      : "data:image/png;base64," + imgBase64;
    setImage(dataUri);
    autoRecognize();
  });
}

/**
 * 自动截图流程（screen-ocr / screen-latex 入口）专用标志与触发器。
 * autoCaptureDone：标记本次进入的自动截图已触发过，防止引擎就绪态抖动
 *   （ready→checking→ready）反复弹出截图框；用户取消截图后也不再自动重弹，
 *   可手动点「截图识别」按钮重试。
 */
const autoCaptureDone = ref(false);

/**
 * 进入即自动截图：仅当 autoCapture 开启、尚未触发、当前模式引擎已就绪时调一次截图。
 * 引擎未就绪时跳过，由 nativeReady/latexReady watcher 在下载完成后补触发。
 */
function maybeAutoCapture() {
  if (!props.autoCapture || autoCaptureDone.value) return;
  if (!engineReady.value) return;
  autoCaptureDone.value = true;
  captureScreen();
}

function resetResults() {
  ocrLines.value = [];
  ocrError.value = "";
  ocrDone.value = false;
  latex.value = "";
  latexError.value = "";
  latexDone.value = false;
}

async function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  await setImageFromFile(file);
  target.value = "";
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) setImageFromFile(file);
}
function onDragOver() {
  dragOver.value = true;
}
function onDragLeave() {
  dragOver.value = false;
}

async function onPaste(e: ClipboardEvent) {
  const item = Array.from(e.clipboardData?.items || []).find((i) =>
    i.type.startsWith("image/"),
  );
  const file = item?.getAsFile();
  if (file) await setImageFromFile(file);
}

// ─── 识别执行 ────────────────────────────────────────────────────────
async function recognizeText() {
  if (!recognizeSrc.value || !nativeReady.value) return;
  // 并发保护：onMounted 的 checkNative 会让 ready 态瞬时抖动（ready→checking→ready），
  // 从而二次触发引擎就绪 watcher；此处避免对同一图片并发识别。
  if (ocrLoading.value) return;
  ocrLoading.value = true;
  ocrError.value = "";
  ocrLines.value = [];
  try {
    const result = await window.services.ocrImageDetail(recognizeSrc.value);
    if (result.ok) {
      ocrLines.value = result.lines ?? [];
      if (ocrLines.value.length === 0) error("未识别到文字");
      else {
        success(`识别完成，共 ${ocrLines.value.length} 行`);
        // 上抛历史记录：只有真正调识别服务成功才留一笔（命中缓存不会进此分支）
        emit("history", {
          kind: "ocr-text",
          thumbnail: imageSrc.value,
          title: ocrLines.value[0]?.text
            ? ocrLines.value[0].text.slice(0, 40)
            : "（未识别到文字）",
          payload: {
            kind: "ocr-text",
            imageSrc: imageSrc.value,
            lines: ocrLines.value.map((l) => ({ ...l })),
          },
        });
      }
    } else {
      ocrError.value = result.error || "识别失败";
      error(ocrError.value);
    }
  } catch (err: any) {
    ocrError.value = err?.message ? String(err.message) : String(err);
    error(ocrError.value);
  } finally {
    ocrDone.value = true;
    ocrLoading.value = false;
  }
}

async function recognizeFormula() {
  if (!recognizeSrc.value || !latexReady.value) return;
  // 并发保护：与 recognizeText 同理，防止引擎就绪态抖动引发的重复识别。
  if (latexLoading.value) return;
  latexLoading.value = true;
  latexError.value = "";
  latex.value = "";
  try {
    const result = await window.services.latexRecognizeDetail(
      recognizeSrc.value,
    );
    if (result.ok) {
      latex.value = result.latex || "";
      if (!latex.value) error("未识别到公式");
      else {
        success("公式识别完成");
        // 上抛历史记录：只有真正调识别服务成功才留一笔（命中缓存不会进此分支）
        emit("history", {
          kind: "ocr-formula",
          thumbnail: imageSrc.value,
          title: latex.value.slice(0, 40),
          payload: {
            kind: "ocr-formula",
            imageSrc: imageSrc.value,
            latex: latex.value,
          },
        });
      }
    } else {
      latexError.value = result.error || "识别失败";
      error(latexError.value);
    }
  } catch (err: any) {
    latexError.value = err?.message ? String(err.message) : String(err);
    error(latexError.value);
  } finally {
    latexDone.value = true;
    latexLoading.value = false;
  }
}

/** 统一的「识别」入口：按当前模式派发；已识别过则重新识别（覆盖结果）。 */
async function recognize() {
  if (mode.value === "text") await recognizeText();
  else await recognizeFormula();
}

// ─── 复制 ────────────────────────────────────────────────────────────
function copyLine(text: string) {
  window.ztools.copyText(text);
  success("已复制该行");
}

function copyAllText() {
  const text = ocrLines.value.map((l) => l.text).join("\n");
  if (!text) return;
  window.ztools.copyText(text);
  success("已复制全部文字");
}

function copyLatex(kind: "raw" | "inline" | "display") {
  if (!latex.value) return;
  let text = latex.value;
  if (kind === "inline") text = "$" + latex.value + "$";
  else if (kind === "display") text = "$$" + latex.value + "$$";
  window.ztools.copyText(text);
  success(
    kind === "raw"
      ? "已复制 LaTeX 源码"
      : kind === "inline"
        ? "已复制 $…$ 形式"
        : "已复制 $$…$$ 形式",
  );
}

// ─── KaTeX 渲染 ─────────────────────────────────────────────────────
// 用 computed + v-html：切换模式导致预览 div 重新挂载时，Vue 会自动按当前
// 缓存的 latex 重新写入 innerHTML，无需依赖 latex 值变化触发 watcher
// （切走再切回时 latex 不变，watch 不会触发，纯手动 innerHTML 会留下空 div）。
const latexHtml = computed(() => {
  const val = latex.value;
  if (!val) return "";
  try {
    return katex.renderToString(val, {
      displayMode: true,
      throwOnError: false,
      output: "html",
    });
  } catch (e: any) {
    return (
      '<span class="katex-error">渲染失败：' +
      (e?.message || String(e)) +
      "</span>"
    );
  }
});

// ─── 外部 initialImage 自动识别 ──────────────────────────────────────
// 引擎未就绪时仅载入图片（不识别），就绪后由下方 watcher 按当前模式补识别。
async function applyInitial(image: string, targetMode: "text" | "formula") {
  if (!image) return;
  mode.value = targetMode;
  setImage(image);
  autoRecognize();
}

// 模式变化上报父组件：immediate 保证每次重建即同步初始模式。
watch(
  mode,
  (m) => emit("mode-change", m),
  { immediate: true },
);

watch(
  () => props.initialImage,
  (image) => {
    if (image) applyInitial(image, props.initialMode);
  },
  { immediate: true },
);

// 文字引擎就绪后补识别：覆盖「下载期间选图」与「切到文字模式时引擎仍在下载」两种场景。
// 另覆盖 autoCapture（screen-ocr 入口）：引擎未就绪时截图被搁置，就绪后自动补截图。
watch(nativeReady, (ready) => {
  if (!ready || mode.value !== "text") return;
  if (recognizeSrc.value && !ocrDone.value) {
    nextTick(() => recognizeText());
  } else if (props.autoCapture && !autoCaptureDone.value) {
    maybeAutoCapture();
  }
});

// 公式引擎就绪后补识别：与文字引擎对称，含 autoCapture（screen-latex 入口）补截图。
watch(latexReady, (ready) => {
  if (!ready || mode.value !== "formula") return;
  if (recognizeSrc.value && !latexDone.value) {
    nextTick(() => recognizeFormula());
  } else if (props.autoCapture && !autoCaptureDone.value) {
    maybeAutoCapture();
  }
});

onMounted(() => {
  window.addEventListener("paste", onPaste);
  checkNative();
  checkLatex();
  // 截图识别 feature（screen-ocr / screen-latex）进入即自动截屏：
  // 引擎已就绪则立即截图，否则由上方 nativeReady/latexReady watcher 在就绪后触发。
  maybeAutoCapture();
});

// keep-alive 缓存后切 tab 触发 onActivated/onDeactivated（而非重新挂载）：
//   - activated：重绑 paste 监听（deactivated 时已移除）、重新 check 引擎状态
//     （长时间切走后 ready 可能已过期），不再重复触发自动截图（autoCaptureDone
//     在缓存实例中保留为 true，未触发过的由引擎就绪 watcher 补截图）。
//   - deactivated：暂停 paste 监听，避免非可见时仍响应剪贴板。
onActivated(() => {
  window.addEventListener("paste", onPaste);
  checkNative();
  checkLatex();
});

onDeactivated(() => {
  window.removeEventListener("paste", onPaste);
});

onUnmounted(() => {
  window.removeEventListener("paste", onPaste);
  window.services.ocrDispose();
  window.services.latexDispose();
});
</script>

<template>
  <div class="recognize">
    <!-- 主体：左右结构 -->
    <div
      class="stage"
      :class="{ 'drag-over': dragOver }"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- 左：图片预览 + 底部操作按钮 -->
      <div class="pane pane-image">
        <div class="image-canvas">
          <OcrImageViewer
            v-if="mode === 'text'"
            :image-src="imageSrc"
            :lines="ocrLines"
            :loading="ocrLoading"
            :hide-result="true"
            empty-text="选择图片或截图识别，也可拖入 / 粘贴图片"
            @copy="copyLine"
            @hover="onViewerHover"
          />
          <template v-else>
            <img
              v-if="imageSrc"
              :src="imageSrc"
              alt="公式图片"
              class="formula-img"
            />
            <div v-else class="empty">
              <div class="empty-icon">🖼️</div>
              <div class="empty-text">
                选择图片或截图识别，也可拖入 / 粘贴图片
              </div>
            </div>
            <div v-if="latexLoading" class="loading-overlay">识别中…</div>
          </template>
        </div>

        <!-- 底部操作：选择图片（左）· 截图识别（右） -->
        <div class="image-actions">
          <ZButton size="small" type="text" @click="pickImage">
            <template #icon>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
              >
                <!-- Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE -->
                <path
                  fill="currentColor"
                  d="M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm0-2h14V5H5zm0 0V5zm2-2h10q.3 0 .45-.275t-.05-.525l-2.75-3.675q-.15-.2-.4-.2t-.4.2L11.25 16L9.4 13.525q-.15-.2-.4-.2t-.4.2l-2 2.675q-.2.25-.05.525T7 17m2.563-7.438Q10 9.125 10 8.5t-.437-1.062T8.5 7t-1.062.438T7 8.5t.438 1.063T8.5 10t1.063-.437"
                />
              </svg>
            </template>
            选择图片
          </ZButton>
          <ZButton size="small" type="text" @click="captureScreen">
            <template #icon>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
              >
                <!-- Icon from Material Design Icons by Pictogrammers - https://github.com/Templarian/MaterialDesign/blob/master/LICENSE -->
                <path
                  fill="currentColor"
                  d="M7 17V1H5v4H1v2h4v10a2 2 0 0 0 2 2h10v4h2v-4h4v-2m-6-2h2V7a2 2 0 0 0-2-2H9v2h8z"
                />
              </svg>
            </template>
            截图识别
          </ZButton>
        </div>
      </div>

      <!-- 右：结果面板 -->
      <div class="pane pane-result">
        <!-- 模式切换：独占一行撑满 -->
        <div
          class="mode-switch"
          :class="{ dark: isDark }"
          role="tablist"
          aria-label="识别模式"
          ref="modeSwitchRef"
        >
          <!-- 滑动高亮指示条：吸附到当前模式按钮 -->
          <span
            class="mode-indicator"
            :class="{ 'no-anim': modeNoAnim }"
            :style="{
              transform: `translateX(${modeIndicator.x}px)`,
              width: modeIndicator.w ? `${modeIndicator.w}px` : '0px'
            }"
          ></span>
          <button
            type="button"
            role="tab"
            class="mode-btn"
            :class="{ active: mode === 'text' }"
            :aria-selected="mode === 'text'"
            :ref="(el) => setModeItemRef(el, 0)"
            @click="switchMode('text')"
          >
            文字
          </button>
          <button
            type="button"
            role="tab"
            class="mode-btn"
            :class="{ active: mode === 'formula' }"
            :aria-selected="mode === 'formula'"
            :ref="(el) => setModeItemRef(el, 1)"
            @click="switchMode('formula')"
          >
            公式
          </button>
        </div>

        <!-- 引擎未就绪引导（按当前模式） -->
        <div v-if="!engineReady" class="engine-guide">
          <EngineStatusCard
            :show-actions="false"
            style="width: 100%;height: 100%;justify-content: center;"
            :engine-kind="mode === 'text' ? 'wechat' : 'latex'"
            @downloaded="mode === 'text' ? checkNative() : checkLatex()"
          />
        </div>

        <!-- 结果区 -->
        <template v-else>
          <!-- 文字模式结果 -->
          <div v-if="mode === 'text'" class="result-body">
            <div v-if="ocrLoading" class="result-empty">识别中…</div>
            <div v-else-if="ocrError" class="result-empty error">
              {{ ocrError }}
            </div>
            <div
              v-else-if="ocrDone && ocrLines.length === 0"
              class="result-empty"
            >
              未识别到文字
            </div>
            <div v-else-if="!ocrDone" class="result-empty placeholder">
              选择图片或截图后自动识别，结果将在此显示
            </div>
            <template v-else>
              <div class="result-head">
                <span class="result-title"
                  >识别明细（{{ ocrLines.length }} 行）</span
                >
                <ZButton size="small" @click="copyAllText">复制全部</ZButton>
              </div>
              <div class="line-list">
                <div
                  v-for="(line, i) in ocrLines"
                  :key="i"
                  class="result-line"
                  :class="{ active: hoveredIndex === i }"
                  @mouseenter="hoveredIndex = i"
                  @mouseleave="hoveredIndex = -1"
                  @click="copyLine(line.text)"
                >
                  <span class="result-rate"
                    >{{ (line.rate * 100).toFixed(0) }}%</span
                  >
                  <span class="result-text">{{ line.text }}</span>
                </div>
              </div>
            </template>
          </div>

          <!-- 公式模式结果 -->
          <div v-else class="result-body">
            <div v-if="latexLoading" class="result-empty">识别中…</div>
            <div v-else-if="latexError" class="result-empty error">
              {{ latexError }}
            </div>
            <div v-else-if="latexDone && !latex" class="result-empty">
              未识别到公式
            </div>
            <div v-else-if="!latexDone" class="result-empty placeholder">
              选择图片或截图后自动识别，结果将在此显示
            </div>
            <template v-else>
              <div class="formula-layout" :class="{ dark: isDark }">
                <!-- 上半：渲染预览（随下方源码实时渲染） -->
                <div class="result-section formula-half">
                  <div class="section-title">渲染预览</div>
                  <div class="katex-preview" v-html="latexHtml"></div>
                </div>
                <!-- 下半：LaTeX 源码，可编辑 -->
                <div class="result-section formula-half">
                  <div class="section-title">LaTeX 源码</div>
                  <textarea
                    class="latex-source"
                    v-model="latex"
                    spellcheck="false"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    placeholder="可编辑 LaTeX 源码，上方预览实时渲染"
                  ></textarea>
                </div>
              </div>
              <div class="copy-actions">
                <ZButton @click="copyLatex('raw')">复制源码</ZButton>
                <ZButton @click="copyLatex('inline')">复制 $…$</ZButton>
                <ZButton @click="copyLatex('display')">复制 $$…$$</ZButton>
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="file-input"
      @change="onFileChange"
    />
  </div>
</template>

<style scoped>
.recognize {
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
  height: 100%;
}

/* ── 主体左右结构 ── */
.stage {
  flex: 1;
  display: flex;
  gap: 14px;
  min-height: 0;
  padding: 14px;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.stage.drag-over {
  border-color: var(--primary-color, #1976d2);
  background: var(--hover-bg, rgba(25, 118, 210, 0.05));
}

/* 左：图片预览 + 底部操作 */
.pane-image {
  flex: 1 1 50%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 200px;
  position: relative;
}

.image-canvas {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  overflow: hidden;
  min-height: 0;
}

.formula-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 14px;
  border-radius: 8px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 0;
}

.empty-icon {
  font-size: 40px;
  opacity: 0.6;
}

.empty-text {
  font-size: 13px;
  color: var(--text-secondary, #999);
  text-align: center;
}

/* 底部操作按钮：选择图片（左对齐）· 截图识别（右对齐） */
.image-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  position: absolute;
  top: 0;
  width: 100%;

  .zt-button {
    height: 34.8px;
    color: #666666;
  }
}

/* 右：结果面板 */
.pane-result {
  flex: 1 1 50%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0;
  background: var(--pane-bg, transparent);
  overflow: hidden;
}

/* 模式切换：独占一行撑满 */
.mode-switch {
  position: relative;
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--sub-bar-bg, rgba(0, 0, 0, 0.05));
  border-radius: 9px;
}

/* 滑动高亮指示条：吸附到当前模式按钮，背景即原 active 底色 */
.mode-indicator {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  border-radius: 7px;
  background: var(--sub-item-active-bg, #fff);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  pointer-events: none;
  z-index: 0;
  transition:
    transform 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    width 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.mode-indicator.no-anim {
  transition: none;
}

/* scoped 下 :global 失效，改用 .dark 类驱动暗色高亮（不刺眼） */
.mode-switch.dark .mode-indicator {
  background: var(--sub-item-active-bg, rgba(255, 255, 255, 0.08));
  box-shadow: none;
}

.mode-btn {
  flex: 1;
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  line-height: 1.4;
  border-radius: 7px;
  cursor: pointer;
  font-family: inherit;
  /* 置于指示条之上，使文字始终清晰 */
  position: relative;
  z-index: 1;
  transition: color 0.15s;
  white-space: nowrap;
}

/* 激活态：仅着色 + 加粗，背景由 .mode-indicator 滑动提供 */
.mode-btn.active {
  color: var(--primary-color, #1976d2);
  font-weight: 600;
}

/* 引擎引导 */
.engine-guide {
  flex: 1;
  overflow-y: auto;
}

/* 结果区 */
.result-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
}

.result-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-secondary, #999);
  font-size: 14px;
  text-align: center;
}

.result-empty.error {
  color: #e53935;
}

.result-empty.placeholder {
  opacity: 0.7;
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.result-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #666);
}

.line-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.result-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}

.result-line:hover,
.result-line.active {
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
}

.result-rate {
  color: var(--text-secondary, #999);
  font-size: 12px;
  min-width: 34px;
  flex-shrink: 0;
}

.result-text {
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}

/* 公式结果 */
.result-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 渲染预览与源码上下两半，各占一半高度撑满 */
.formula-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.formula-half {
  flex: 1 1 0;
  min-height: 0;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #666);
}

.katex-preview {
  flex: 1 1 0;
  min-height: 0;
  padding: 16px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e5e6eb);
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* scoped 下 :global 失效，用 .dark 类驱动暗色渲染预览 */
.formula-layout.dark .katex-preview {
  background: #2a2a2a;
  border-color: var(--border-color, #374151);
  color: var(--text-color, #f3f4f6);
}

.katex-error {
  color: #e53935;
  font-size: 13px;
}

.latex-source {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 12px;
  background: var(--code-bg, #f5f5f5);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e5e6eb);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  color: var(--text-color, #333);
  outline: none;
}

/* scoped 下 :global 失效，用 .dark 类驱动暗色 LaTeX 源码框 */
.formula-layout.dark .latex-source {
  background: var(--code-bg, #2a2a2a);
  color: var(--text-color, #f3f4f6);
  border-color: var(--border-color, #374151);
}

.copy-actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.file-input {
  display: none;
}
</style>
