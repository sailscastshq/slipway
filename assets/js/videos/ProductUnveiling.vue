<script setup>
import { computed } from 'vue'
import { useFrame, useVideoConfig, interpolate, Easing } from 'pellicule'

defineVideoConfig({
  durationInSeconds: 45,
  fps: 60,
  width: 1920,
  height: 1080
})

const frame = useFrame()
const { fps } = useVideoConfig()

// ── Scene timing ──
const scenes = {
  whatif:    { start: 0,           dur: fps * 3 },    // 0-3s: "What if..." → "you owned everything?"
  slippy:   { start: fps * 3,     dur: fps * 3 },    // 3-6s: Slippy BIG entrance
  brand:    { start: fps * 6,     dur: fps * 4 },    // 6-10s: "Slipway" massive + tagline
  problem:  { start: fps * 10,    dur: fps * 3.5 },  // 10-13.5s: Cloud failed you
  slide:    { start: fps * 13.5,  dur: fps * 4 },    // 13.5-17.5s: slipway slide — hero moment
  services: { start: fps * 17.5,  dur: fps * 3.5 },  // 17.5-21s: databases
  lookout:  { start: fps * 21,    dur: fps * 3 },    // 21-24s: monitoring
  tools:    { start: fps * 24,    dur: fps * 4 },    // 24-28s: built-in tools
  open:     { start: fps * 28,    dur: fps * 4 },    // 28-32s: open source + install
  cta:      { start: fps * 32,    dur: fps * 5 },    // 32-37s: CTA
  finale:   { start: fps * 37,    dur: fps * 8 },    // 37-45s: finale with Slippy
}

function useScene(name) {
  const s = scenes[name]
  const localFrame = computed(() => Math.max(0, frame.value - s.start))
  const progress = computed(() => Math.min(1, Math.max(0, (frame.value - s.start) / s.dur)))
  const isActive = computed(() => frame.value >= s.start && frame.value < s.start + s.dur)
  return { localFrame, progress, isActive, dur: s.dur }
}

// ── Background ──
const bgColor = computed(() => {
  const f = frame.value
  const whiteScenes = ['whatif', 'slide', 'lookout', 'cta']
  for (const name of whiteScenes) {
    const s = scenes[name]
    if (f >= s.start && f < s.start + s.dur) return '#ffffff'
  }
  return '#000000'
})

// ═══════════════════════════════════════════
// SCENE 1: "What if..." (white bg)
// ═══════════════════════════════════════════
const whatif = useScene('whatif')
const whatifLine1Opacity = computed(() =>
  interpolate(whatif.localFrame.value, [0, 25], [0, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const whatifLine2Opacity = computed(() =>
  interpolate(whatif.localFrame.value, [50, 80], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const whatifLine2Y = computed(() =>
  interpolate(whatif.localFrame.value, [50, 80], [40, 0], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const whatifFadeOut = computed(() =>
  interpolate(whatif.progress.value, [0.8, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)

// ═══════════════════════════════════════════
// SCENE 2: Slippy entrance (dark bg)
// ═══════════════════════════════════════════
const slippy = useScene('slippy')
const slippyScale = computed(() => {
  const f = slippy.localFrame.value
  if (f < 20) return interpolate(f, [0, 20], [0.2, 1.15], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
  return interpolate(f, [20, 35], [1.15, 1], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
})
const slippyOpacity = computed(() =>
  interpolate(slippy.localFrame.value, [0, 10], [0, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const slippyBob = computed(() =>
  slippy.localFrame.value > 40 ? Math.sin((slippy.localFrame.value - 40) / 18) * 10 : 0
)
const winkEye = computed(() => {
  const f = slippy.localFrame.value
  if (f < 60 || f > 90) return 1
  return interpolate(f, [60, 70, 80, 90], [1, 0.05, 0.05, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
})
const slippyLabelOp = computed(() =>
  interpolate(slippy.localFrame.value, [35, 55], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const slippyLabelY = computed(() =>
  interpolate(slippy.localFrame.value, [35, 55], [25, 0], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const slippyFadeOut = computed(() =>
  interpolate(slippy.progress.value, [0.75, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
function tentRot(index) {
  return computed(() => Math.sin((frame.value + index * 40) / 18) * (10 + index * 3))
}
const t1 = tentRot(0), t2 = tentRot(1), t3 = tentRot(2), t4 = tentRot(3)

// ═══════════════════════════════════════════
// SCENE 3: Brand reveal (dark bg)
// ═══════════════════════════════════════════
const brand = useScene('brand')
const brandTitleScale = computed(() =>
  interpolate(brand.localFrame.value, [0, 40], [0.4, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const brandTitleOpacity = computed(() =>
  interpolate(brand.localFrame.value, [0, 25], [0, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const brandTagOpacity = computed(() =>
  interpolate(brand.localFrame.value, [70, 100], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const brandTagY = computed(() =>
  interpolate(brand.localFrame.value, [70, 100], [30, 0], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const brandFadeOut = computed(() =>
  interpolate(brand.progress.value, [0.8, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)

// ═══════════════════════════════════════════
// SCENE 4: Problem (dark bg)
// ═══════════════════════════════════════════
const problem = useScene('problem')
const probLine1Op = computed(() =>
  interpolate(problem.localFrame.value, [0, 20], [0, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const probLine2Op = computed(() =>
  interpolate(problem.localFrame.value, [40, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const probLine2Scale = computed(() =>
  interpolate(problem.localFrame.value, [40, 60], [1.2, 1], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const probItems = ['Vendor lock-in.', 'Surprise bills.', 'Zero ownership.']
function probItemStyle(i) {
  const delay = 80 + i * 18
  const opacity = interpolate(problem.localFrame.value, [delay, delay + 12], [0, 1], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const x = interpolate(problem.localFrame.value, [delay, delay + 12], [-80, 0], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return { opacity: opacity * probFadeOut.value, transform: `translateX(${x}px)` }
}
const probFadeOut = computed(() =>
  interpolate(problem.progress.value, [0.8, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)

// ═══════════════════════════════════════════
// SCENE 5: slipway slide — hero (white bg)
// ═══════════════════════════════════════════
const slide = useScene('slide')
const slideLabelOp = computed(() =>
  interpolate(slide.localFrame.value, [0, 20], [0, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const slideTitleOp = computed(() =>
  interpolate(slide.localFrame.value, [10, 35], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const slideTitleY = computed(() =>
  interpolate(slide.localFrame.value, [10, 35], [50, 0], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
// Terminal showing slipway slide
const slideTermOp = computed(() =>
  interpolate(slide.localFrame.value, [50, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const slideTermY = computed(() =>
  interpolate(slide.localFrame.value, [50, 70], [40, 0], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const slideCmdText = '$ slipway slide'
const slideCmdChars = computed(() => {
  if (slide.localFrame.value < 80) return 0
  return Math.min(Math.floor((slide.localFrame.value - 80) * 0.5), slideCmdText.length)
})
const slideCmdCursor = computed(() =>
  slideCmdChars.value < slideCmdText.length && Math.floor(slide.localFrame.value / 8) % 2 === 0
)
// Deploy output lines
const slideOutput = ['Building image...', 'Health check passed.', 'Traffic switched. Live.']
function slideOutputStyle(i) {
  const base = 110 + slideCmdText.length * 2
  const delay = base + i * 20
  const opacity = interpolate(slide.localFrame.value, [delay, delay + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return { opacity }
}
const slideDescOp = computed(() =>
  interpolate(slide.localFrame.value, [60, 85], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const slideFadeOut = computed(() =>
  interpolate(slide.progress.value, [0.85, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)

// ═══════════════════════════════════════════
// SCENE 6: Services (dark bg)
// ═══════════════════════════════════════════
const services = useScene('services')
const svcWords = ['Postgres.', 'MySQL.', 'MongoDB.', 'Redis.']
function svcWordStyle(i) {
  const delay = i * 18
  const opacity = interpolate(services.localFrame.value, [delay, delay + 15], [0, 1], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const y = interpolate(services.localFrame.value, [delay, delay + 15], [40, 0], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return { opacity: opacity * svcFadeOut.value, transform: `translateY(${y}px)` }
}
const svcOneClickOp = computed(() =>
  interpolate(services.localFrame.value, [90, 110], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const svcOneClickScale = computed(() =>
  interpolate(services.localFrame.value, [90, 110], [0.8, 1], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const svcDescOp = computed(() =>
  interpolate(services.localFrame.value, [120, 145], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const svcFadeOut = computed(() =>
  interpolate(services.progress.value, [0.8, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)

// ═══════════════════════════════════════════
// SCENE 7: Lookout (white bg)
// ═══════════════════════════════════════════
const lookout = useScene('lookout')
const lookoutTitleOp = computed(() =>
  interpolate(lookout.localFrame.value, [0, 25], [0, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const lookoutTitleScale = computed(() =>
  interpolate(lookout.localFrame.value, [0, 25], [0.85, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const lookoutDescOp = computed(() =>
  interpolate(lookout.localFrame.value, [40, 65], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const lookoutDescY = computed(() =>
  interpolate(lookout.localFrame.value, [40, 65], [30, 0], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const lookoutFadeOut = computed(() =>
  interpolate(lookout.progress.value, [0.8, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)

// ═══════════════════════════════════════════
// SCENE 8: Tools (dark bg)
// ═══════════════════════════════════════════
const tools = useScene('tools')
const toolsList = [
  { name: 'Helm', desc: 'App management', color: '#0ea5e9' },
  { name: 'Bridge', desc: 'Data access', color: '#8b5cf6' },
  { name: 'Dock', desc: 'Database studio', color: '#10b981' },
  { name: 'Quest', desc: 'Background jobs', color: '#f59e0b' },
  { name: 'Content', desc: 'CMS built-in', color: '#ef4444' },
  { name: 'Bosun', desc: 'Self-admin', color: '#06b6d4' },
]
const toolsTitleOp = computed(() =>
  interpolate(tools.localFrame.value, [0, 25], [0, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const toolsSubOp = computed(() =>
  interpolate(tools.localFrame.value, [20, 45], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const toolsFadeOut = computed(() =>
  interpolate(tools.progress.value, [0.8, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
function toolCardStyle(i) {
  const delay = 40 + i * 10
  const opacity = interpolate(tools.localFrame.value, [delay, delay + 14], [0, 1], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const scale = interpolate(tools.localFrame.value, [delay, delay + 14], [0.7, 1], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return { opacity: opacity * toolsFadeOut.value, transform: `scale(${scale})` }
}

// ═══════════════════════════════════════════
// SCENE 9: Open Source (dark bg)
// ═══════════════════════════════════════════
const open = useScene('open')
const openTitleOp = computed(() =>
  interpolate(open.localFrame.value, [0, 30], [0, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const openTitleScale = computed(() =>
  interpolate(open.localFrame.value, [0, 30], [0.8, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const openSubOp = computed(() =>
  interpolate(open.localFrame.value, [35, 55], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const cmdText = 'curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh | bash'
const cmdChars = computed(() => {
  if (open.localFrame.value < 80) return 0
  return Math.min(Math.floor((open.localFrame.value - 80) * 0.8), cmdText.length)
})
const cmdCursor = computed(() =>
  cmdChars.value < cmdText.length && Math.floor(open.localFrame.value / 8) % 2 === 0
)
const cmdOpacity = computed(() =>
  interpolate(open.localFrame.value, [60, 80], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const openFadeOut = computed(() =>
  interpolate(open.progress.value, [0.85, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)

// ═══════════════════════════════════════════
// SCENE 10: CTA (white bg)
// ═══════════════════════════════════════════
const cta = useScene('cta')
const ctaTitleOp = computed(() =>
  interpolate(cta.localFrame.value, [0, 35], [0, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const ctaTitleScale = computed(() =>
  interpolate(cta.localFrame.value, [0, 35], [0.85, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const ctaBtnOp = computed(() =>
  interpolate(cta.localFrame.value, [60, 85], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const ctaBtnY = computed(() =>
  interpolate(cta.localFrame.value, [60, 85], [30, 0], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const ctaFadeOut = computed(() =>
  interpolate(cta.progress.value, [0.85, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)

// ═══════════════════════════════════════════
// SCENE 11: Finale (dark bg, long)
// ═══════════════════════════════════════════
const finale = useScene('finale')
const finSlippyOp = computed(() =>
  interpolate(finale.localFrame.value, [0, 40], [0, 1], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
)
const finSlippyScale = computed(() => {
  const f = finale.localFrame.value
  if (f < 25) return interpolate(f, [0, 25], [0.3, 1.08], { easing: Easing.easeOut, extrapolateRight: 'clamp' })
  return interpolate(f, [25, 40], [1.08, 1], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
})
const finBob = computed(() =>
  finale.localFrame.value > 50 ? Math.sin((finale.localFrame.value - 50) / 22) * 8 : 0
)
const finNameOp = computed(() =>
  interpolate(finale.localFrame.value, [50, 80], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const finNameScale = computed(() =>
  interpolate(finale.localFrame.value, [50, 80], [0.9, 1], { easing: Easing.easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const finTagOp = computed(() =>
  interpolate(finale.localFrame.value, [100, 130], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const finUrlOp = computed(() =>
  interpolate(finale.localFrame.value, [150, 180], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
)
const ft1 = tentRot(0), ft2 = tentRot(1), ft3 = tentRot(2), ft4 = tentRot(3)
</script>

<template>
  <div class="video" :style="{ background: bgColor }">

    <!-- ═══ SCENE 1: What if... (white bg) ═══ -->
    <div v-if="whatif.isActive.value" class="scene center col" :style="{ opacity: whatifFadeOut }">
      <p class="whatif-line1" :style="{ opacity: whatifLine1Opacity }">What if...</p>
      <p class="whatif-line2" :style="{ opacity: whatifLine2Opacity, transform: `translateY(${whatifLine2Y}px)` }">
        you owned your entire stack?
      </p>
    </div>

    <!-- ═══ SCENE 2: Slippy entrance (dark bg) ═══ -->
    <div v-if="slippy.isActive.value" class="scene center col" :style="{ opacity: slippyFadeOut }">
      <svg viewBox="0 0 32 32" fill="none" class="slippy-svg" :style="{
        opacity: slippyOpacity,
        transform: `translateY(${slippyBob}px) scale(${slippyScale})`
      }">
        <path d="M7 17 C7 3 25 3 25 17 Z" stroke="#0ea5e9" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="rgba(14, 165, 233, 0.12)" />
        <path :style="{ transformOrigin: '7px 17px', transform: `rotate(${t1}deg)` }" d="M7 17 C4 21 4 25 8 28" stroke="#0ea5e9" stroke-width="1.2" stroke-linecap="round" />
        <path :style="{ transformOrigin: '12px 17px', transform: `rotate(${t2}deg)` }" d="M12 17 C11 21 10 25 13 28" stroke="#0ea5e9" stroke-width="1.2" stroke-linecap="round" />
        <path :style="{ transformOrigin: '20px 17px', transform: `rotate(${t3}deg)` }" d="M20 17 C21 21 22 25 19 28" stroke="#0ea5e9" stroke-width="1.2" stroke-linecap="round" />
        <path :style="{ transformOrigin: '25px 17px', transform: `rotate(${t4}deg)` }" d="M25 17 C28 21 28 25 24 28" stroke="#0ea5e9" stroke-width="1.2" stroke-linecap="round" />
        <circle cx="13" cy="11" r="1.5" fill="#0ea5e9" />
        <ellipse cx="19" cy="11" rx="1.5" :ry="1.5 * winkEye" fill="#0ea5e9" />
      </svg>
      <p class="slippy-label" :style="{ opacity: slippyLabelOp * slippyFadeOut, transform: `translateY(${slippyLabelY}px)` }">
        Meet Slippy.
      </p>
    </div>

    <!-- ═══ SCENE 3: Brand "Slipway" (dark bg) ═══ -->
    <div v-if="brand.isActive.value" class="scene center col" :style="{ opacity: brandFadeOut }">
      <h1 class="brand-title" :style="{
        opacity: brandTitleOpacity,
        transform: `scale(${brandTitleScale})`
      }">Slipway</h1>
      <p class="brand-tag" :style="{
        opacity: brandTagOpacity,
        transform: `translateY(${brandTagY}px)`
      }">
        The deployment platform for <strong>Sails</strong><br/>
        and <strong>The Boring JavaScript Stack.</strong>
      </p>
    </div>

    <!-- ═══ SCENE 4: Problem (dark bg) ═══ -->
    <div v-if="problem.isActive.value" class="scene center col">
      <p class="prob-line1" :style="{ opacity: probLine1Op * probFadeOut }">
        The cloud promised freedom.
      </p>
      <p class="prob-line2" :style="{
        opacity: probLine2Op * probFadeOut,
        transform: `scale(${probLine2Scale})`
      }">
        It delivered lock-in.
      </p>
      <div class="prob-items">
        <span v-for="(item, i) in probItems" :key="i" class="prob-item" :style="probItemStyle(i)">
          {{ item }}
        </span>
      </div>
    </div>

    <!-- ═══ SCENE 5: slipway slide — HERO (white bg) ═══ -->
    <div v-if="slide.isActive.value" class="scene" :style="{ opacity: slideFadeOut }">
      <div class="slide-left">
        <span class="slide-label" :style="{ opacity: slideLabelOp }">DEPLOY</span>
        <h2 class="slide-title" :style="{ opacity: slideTitleOp, transform: `translateY(${slideTitleY}px)` }">
          Slide into<br/>production.
        </h2>
        <p class="slide-desc" :style="{ opacity: slideDescOp }">
          Zero-downtime blue-green deployments.<br/>
          Automatic health checks. One command.
        </p>
      </div>
      <div class="slide-right">
        <div class="slide-terminal" :style="{ opacity: slideTermOp, transform: `translateY(${slideTermY}px)` }">
          <div class="term-header">
            <div class="tdot red" /><div class="tdot yellow" /><div class="tdot green" />
          </div>
          <div class="term-body">
            <div class="term-line">
              <span class="ttext">{{ slideCmdText.slice(0, slideCmdChars) }}</span>
              <span v-if="slideCmdCursor" class="tcursor-dark">|</span>
            </div>
            <div v-for="(line, i) in slideOutput" :key="i" class="term-output" :style="slideOutputStyle(i)">
              <span class="tout-check">&#10003;</span> {{ line }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ SCENE 6: Services (dark bg) ═══ -->
    <div v-if="services.isActive.value" class="scene center col">
      <div class="svc-words">
        <span v-for="(word, i) in svcWords" :key="i" class="svc-word" :style="svcWordStyle(i)">{{ word }}</span>
      </div>
      <p class="svc-oneclick" :style="{
        opacity: svcOneClickOp * svcFadeOut,
        transform: `scale(${svcOneClickScale})`
      }">One click.</p>
      <p class="svc-desc" :style="{ opacity: svcDescOp * svcFadeOut }">
        Connection strings auto-injected. Zero config.
      </p>
    </div>

    <!-- ═══ SCENE 7: Lookout (white bg) ═══ -->
    <div v-if="lookout.isActive.value" class="scene center col" :style="{ opacity: lookoutFadeOut }">
      <h2 class="lookout-title" :style="{
        opacity: lookoutTitleOp,
        transform: `scale(${lookoutTitleScale})`
      }">See everything.</h2>
      <p class="lookout-desc" :style="{
        opacity: lookoutDescOp,
        transform: `translateY(${lookoutDescY}px)`
      }">
        CPU. Memory. Logs. Deployments.<br/>
        All in real-time.
      </p>
    </div>

    <!-- ═══ SCENE 8: Tools (dark bg) ═══ -->
    <div v-if="tools.isActive.value" class="scene center col">
      <h2 class="tools-title" :style="{ opacity: toolsTitleOp * toolsFadeOut }">Everything you need.</h2>
      <p class="tools-sub" :style="{ opacity: toolsSubOp * toolsFadeOut }">Nothing you don't.</p>
      <div class="tools-grid">
        <div v-for="(tool, i) in toolsList" :key="i" class="tool-card" :style="{ ...toolCardStyle(i), borderColor: `${tool.color}40` }">
          <div class="tool-dot" :style="{ backgroundColor: tool.color }" />
          <div class="tool-info">
            <div class="tool-name">{{ tool.name }}</div>
            <div class="tool-desc">{{ tool.desc }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ SCENE 9: Open Source (dark bg) ═══ -->
    <div v-if="open.isActive.value" class="scene center col" :style="{ opacity: openFadeOut }">
      <h2 class="open-title" :style="{ opacity: openTitleOp, transform: `scale(${openTitleScale})` }">
        100% Open Source.
      </h2>
      <p class="open-sub" :style="{ opacity: openSubOp }">MIT Licensed. Fork it. Make it yours.</p>
      <div class="terminal" :style="{ opacity: cmdOpacity }">
        <div class="term-header">
          <div class="tdot red" /><div class="tdot yellow" /><div class="tdot green" />
        </div>
        <div class="term-body">
          <span class="tprompt">$</span>
          <span class="ttext-light">{{ cmdText.slice(0, cmdChars) }}</span>
          <span v-if="cmdCursor" class="tcursor-light">|</span>
        </div>
      </div>
    </div>

    <!-- ═══ SCENE 10: CTA (white bg) ═══ -->
    <div v-if="cta.isActive.value" class="scene center col" :style="{ opacity: ctaFadeOut }">
      <h2 class="cta-title" :style="{
        opacity: ctaTitleOp,
        transform: `scale(${ctaTitleScale})`
      }">
        Deploy your first app<br/>in under 5 minutes.
      </h2>
      <div class="cta-btn" :style="{ opacity: ctaBtnOp, transform: `translateY(${ctaBtnY}px)` }">
        Get Started
      </div>
      <p class="cta-url" :style="{ opacity: ctaBtnOp }">docs.sailscasts.com/slipway</p>
    </div>

    <!-- ═══ SCENE 11: Finale (dark bg, long hold) ═══ -->
    <div v-if="finale.isActive.value" class="scene center col">
      <svg viewBox="0 0 32 32" fill="none" class="fin-slippy" :style="{
        opacity: finSlippyOp,
        transform: `translateY(${finBob}px) scale(${finSlippyScale})`
      }">
        <path d="M7 17 C7 3 25 3 25 17 Z" stroke="#0ea5e9" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="rgba(14, 165, 233, 0.15)" />
        <path :style="{ transformOrigin: '7px 17px', transform: `rotate(${ft1}deg)` }" d="M7 17 C4 21 4 25 8 28" stroke="#0ea5e9" stroke-width="1.2" stroke-linecap="round" />
        <path :style="{ transformOrigin: '12px 17px', transform: `rotate(${ft2}deg)` }" d="M12 17 C11 21 10 25 13 28" stroke="#0ea5e9" stroke-width="1.2" stroke-linecap="round" />
        <path :style="{ transformOrigin: '20px 17px', transform: `rotate(${ft3}deg)` }" d="M20 17 C21 21 22 25 19 28" stroke="#0ea5e9" stroke-width="1.2" stroke-linecap="round" />
        <path :style="{ transformOrigin: '25px 17px', transform: `rotate(${ft4}deg)` }" d="M25 17 C28 21 28 25 24 28" stroke="#0ea5e9" stroke-width="1.2" stroke-linecap="round" />
        <circle cx="13" cy="11" r="1.5" fill="#0ea5e9" />
        <circle cx="19" cy="11" r="1.5" fill="#0ea5e9" />
      </svg>
      <h1 class="fin-wordmark" :style="{ opacity: finNameOp, transform: `scale(${finNameScale})` }">Slipway</h1>
      <p class="fin-tag" :style="{ opacity: finTagOp }">Your apps. Your server. Your rules.</p>
      <p class="fin-url" :style="{ opacity: finUrlOp }">docs.sailscasts.com/slipway</p>
    </div>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; }

.video {
  width: 100%; height: 100%;
  font-family: 'Inter', system-ui, sans-serif;
  overflow: hidden;
  position: relative;
}

/* ── Layout ── */
.scene { position: absolute; inset: 0; z-index: 1; }
.center { display: flex; align-items: center; justify-content: center; }
.col { flex-direction: column; gap: 20px; }

/* ═══ Scene 1: What if ═══ */
.whatif-line1 {
  font-size: 48px; font-weight: 300; color: #999999;
  letter-spacing: -1px;
}
.whatif-line2 {
  font-size: 80px; font-weight: 800; color: #1a1a1a;
  letter-spacing: -4px; margin-top: 8px;
}

/* ═══ Scene 2: Slippy ═══ */
.slippy-svg { width: 400px; height: 400px; }
.slippy-label {
  font-size: 52px; font-weight: 300; color: rgba(255,255,255,0.6);
  letter-spacing: -1px;
}

/* ═══ Scene 3: Brand ═══ */
.brand-title {
  font-size: 200px; font-weight: 900; letter-spacing: -10px; line-height: 1;
  color: #ffffff;
}
.brand-tag {
  font-size: 40px; font-weight: 300; color: rgba(255,255,255,0.6);
  letter-spacing: -1px; text-align: center; line-height: 1.4;
}
.brand-tag strong { font-weight: 700; color: rgba(255,255,255,0.9); }

/* ═══ Scene 4: Problem ═══ */
.prob-line1 {
  font-size: 52px; font-weight: 300; color: rgba(255,255,255,0.5);
  letter-spacing: -1px;
}
.prob-line2 {
  font-size: 80px; font-weight: 800; color: #ef4444;
  letter-spacing: -3px; margin-bottom: 20px;
}
.prob-items { display: flex; gap: 32px; }
.prob-item {
  font-size: 28px; font-weight: 500; color: rgba(255,255,255,0.4);
}

/* ═══ Scene 5: Slide (split layout, white bg) ═══ */
.slide-left {
  position: absolute; left: 100px; top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: column; gap: 16px; max-width: 700px;
}
.slide-label {
  font-size: 18px; font-weight: 700; letter-spacing: 6px;
  color: #0284c7; text-transform: uppercase;
}
.slide-title {
  font-size: 80px; font-weight: 900; letter-spacing: -4px;
  line-height: 1.05; color: #1a1a1a;
}
.slide-desc {
  font-size: 26px; font-weight: 400; color: #666666;
  line-height: 1.5; margin-top: 4px;
}
.slide-right {
  position: absolute; right: 80px; top: 50%; transform: translateY(-50%);
}
.slide-terminal {
  background: #1a1a2e; border-radius: 16px; padding: 28px 32px;
  width: 560px; box-shadow: 0 30px 80px rgba(0,0,0,0.15);
}
.term-header { display: flex; gap: 8px; margin-bottom: 20px; }
.tdot { width: 12px; height: 12px; border-radius: 50%; }
.tdot.red { background: #ff5f57; }
.tdot.yellow { background: #ffbd2e; }
.tdot.green { background: #28c840; }
.term-body { font-family: 'JetBrains Mono', monospace; font-size: 20px; }
.term-line { color: #e2e8f0; margin-bottom: 12px; }
.term-output { color: #a3e635; font-size: 17px; margin-top: 8px; }
.tout-check { color: #22c55e; margin-right: 6px; }
.ttext { color: #e2e8f0; }
.tcursor-dark { color: #0ea5e9; }

/* ═══ Scene 6: Services ═══ */
.svc-words {
  display: flex; gap: 40px; margin-bottom: 12px;
}
.svc-word {
  font-size: 72px; font-weight: 800; color: #ffffff;
  letter-spacing: -3px;
}
.svc-oneclick {
  font-size: 56px; font-weight: 800; color: #0ea5e9;
  letter-spacing: -2px;
}
.svc-desc {
  font-size: 28px; color: rgba(255,255,255,0.4);
}

/* ═══ Scene 7: Lookout (white bg) ═══ */
.lookout-title {
  font-size: 88px; font-weight: 900; color: #1a1a1a;
  letter-spacing: -4px;
}
.lookout-desc {
  font-size: 34px; color: #666666; text-align: center;
  line-height: 1.5; letter-spacing: -1px;
}

/* ═══ Scene 8: Tools ═══ */
.tools-title {
  font-size: 80px; font-weight: 900; color: #ffffff;
  letter-spacing: -4px;
}
.tools-sub {
  font-size: 42px; font-weight: 300; color: rgba(255,255,255,0.4);
  letter-spacing: -1px; margin-bottom: 16px;
}
.tools-grid {
  display: grid; grid-template-columns: repeat(3, 280px);
  gap: 16px;
}
.tool-card {
  background: rgba(255,255,255,0.04); border: 1px solid;
  border-radius: 20px; padding: 28px 24px;
  display: flex; align-items: center; gap: 16px;
}
.tool-dot { width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; }
.tool-info { display: flex; flex-direction: column; gap: 2px; }
.tool-name { font-size: 24px; font-weight: 700; color: #ffffff; }
.tool-desc { font-size: 16px; color: rgba(255,255,255,0.4); }

/* ═══ Scene 9: Open Source ═══ */
.open-title {
  font-size: 88px; font-weight: 900; color: #ffffff;
  letter-spacing: -4px;
}
.open-sub {
  font-size: 32px; color: rgba(255,255,255,0.4); margin-bottom: 12px;
}
.terminal {
  background: #0d1117; border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px; padding: 24px 32px;
  min-width: 820px; box-shadow: 0 24px 80px rgba(0,0,0,0.5);
}
.tprompt { color: #10b981; margin-right: 12px; font-family: 'JetBrains Mono', monospace; font-size: 22px; }
.ttext-light { color: #e2e8f0; font-family: 'JetBrains Mono', monospace; font-size: 22px; }
.tcursor-light { color: #10b981; font-family: 'JetBrains Mono', monospace; }

/* ═══ Scene 10: CTA (white bg) ═══ */
.cta-title {
  font-size: 80px; font-weight: 800; color: #1a1a1a;
  letter-spacing: -4px; text-align: center; line-height: 1.15;
}
.cta-btn {
  background: #0ea5e9; color: #ffffff;
  font-size: 28px; font-weight: 700; padding: 22px 60px;
  border-radius: 16px; margin-top: 8px;
}
.cta-url {
  font-size: 24px; color: #999999; letter-spacing: 1px; margin-top: 4px;
}

/* ═══ Scene 11: Finale ═══ */
.fin-slippy { width: 220px; height: 220px; }
.fin-wordmark {
  font-size: 120px; font-weight: 900; color: #ffffff;
  letter-spacing: -5px;
}
.fin-tag {
  font-size: 32px; font-weight: 400; color: rgba(255,255,255,0.5);
  letter-spacing: -1px;
}
.fin-url {
  font-size: 26px; color: rgba(255,255,255,0.3); letter-spacing: 2px;
  margin-top: 8px;
}
</style>
