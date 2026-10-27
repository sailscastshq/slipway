<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import widgetShell from '../../../../api/lib/bearing-widget-shell'
import contract from '../../../../api/lib/app-appearance'
import AppBrand from './AppBrand.vue'
const props = defineProps({
  appearance: Object,
  mode: String,
  surface: String,
  widgetStyles: String
})
const emit = defineEmits(['update:surface'])
const host = ref(null)
const content = ref(null)
let root, panel, trigger, frame, previewWindow, logo, closeTimer
function paint() {
  if (!root) return
  const name = props.appearance.displayName
  for (const [key, value] of Object.entries(
    contract.variables(props.appearance, props.mode)
  ))
    host.value.style.setProperty(key, value)
  host.value.style.colorScheme = props.mode
  host.value.dataset.appearanceMode = props.mode
  const title = root.querySelector('#slipway-bearing-title')
  title.replaceChildren()
  const source =
    props.mode === 'dark' && props.appearance.logoDark
      ? props.appearance.logoDark
      : props.appearance.logoLight
  if (source) {
    logo = title.ownerDocument.createElement('img')
    logo.src = source
    logo.alt = props.appearance.logoText || ''
    logo.className = `bearing-app-logo${
      props.appearance.logoDark ? '' : ' bearing-app-logo-single'
    }`
    logo.addEventListener(
      'error',
      () => {
        logo.hidden = true
      },
      { once: true }
    )
    title.append(logo)
  }
  title.append(title.ownerDocument.createTextNode(name))
  frame.title = `${name} ${props.surface}`
  for (const button of root.querySelectorAll('[data-surface]')) {
    if (button.dataset.surface === props.surface)
      button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  }
  const open = panel.open
  trigger.setAttribute('aria-expanded', String(open))
  trigger.setAttribute(
    'aria-label',
    `${open ? 'Close' : 'Open'} what’s new for ${name}`
  )
  trigger.innerHTML = open
    ? '<span class="bearing-trigger-mark" aria-hidden="true">×</span>'
    : '<span class="bearing-trigger-mark" aria-hidden="true">✦</span><span>What’s new</span>'
}
function openPanel() {
  clearTimeout(closeTimer)
  panel.removeAttribute('data-closing')
  panel.prepend(trigger)
  panel.dataset.openedFrom = 'widget'
  if (!panel.open) panel.showModal()
  paint()
}
function closePanel() {
  if (!panel.open || panel.hasAttribute('data-closing')) return
  const finish = () => {
    panel.close()
    panel.removeAttribute('data-closing')
    root.insertBefore(trigger, panel)
    paint()
    trigger.focus()
  }
  panel.setAttribute('data-closing', '')
  if (previewWindow.matchMedia('(prefers-reduced-motion: reduce)').matches)
    finish()
  else closeTimer = setTimeout(finish, 140)
}
function escape(event) {
  if (event.key === 'Escape' && panel.open) {
    event.preventDefault()
    closePanel()
  }
}
function loaded() {
  const doc = frame.contentDocument
  if (!doc) return
  for (const sheet of document.querySelectorAll('link[rel="stylesheet"],style'))
    doc.head.append(sheet.cloneNode(true))
  // Only sample Vue content is mounted. No production URLs, bootstrap fetches,
  // storage writes, participation handlers or external navigation run here.
  content.value = doc.body
  doc.defaultView.addEventListener('keydown', escape)
}
watch(() => [props.appearance, props.mode, props.surface], paint, {
  deep: true
})
onMounted(() => {
  const doc = host.value.ownerDocument
  previewWindow = doc.defaultView
  host.value.dataset.appAppearance = '1'
  root = host.value.attachShadow({ mode: 'open' })
  root.innerHTML = widgetShell({
    side: 'right',
    appName: props.appearance.displayName,
    widgetStyles: props.widgetStyles
  })
  // The shared production shell links the optional saved appearance stylesheet.
  // Draft colours are bounded variables on this preview host instead.
  root.querySelector('[data-appearance-styles]')?.remove()
  panel = root.querySelector('[data-panel]')
  trigger = root.querySelector('[data-trigger]')
  frame = root.querySelector('[data-frame]')
  const powered = root.querySelector('.bearing-powered-by')
  powered.removeAttribute('href')
  powered.removeAttribute('target')
  powered.setAttribute('aria-disabled', 'true')
  frame.addEventListener('load', loaded)
  frame.srcdoc =
    "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body style='margin:0'></body></html>"
  trigger.addEventListener('click', () =>
    panel.open ? closePanel() : openPanel()
  )
  panel.addEventListener('cancel', (event) => {
    event.preventDefault()
    closePanel()
  })
  panel.addEventListener('click', (event) => {
    if (event.target !== panel) return
    const box = panel.getBoundingClientRect()
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    )
      closePanel()
  })
  for (const button of root.querySelectorAll('[data-surface]'))
    button.addEventListener('click', () =>
      emit('update:surface', button.dataset.surface)
    )
  previewWindow.addEventListener('keydown', escape)
  paint()
  openPanel()
})
onUnmounted(() => {
  clearTimeout(closeTimer)
  previewWindow?.removeEventListener('keydown', escape)
  frame?.contentWindow?.removeEventListener('keydown', escape)
  if (panel?.open) panel.close()
})
</script>
<template>
  <div
    class="min-h-screen"
    :data-appearance-mode="mode"
    :style="{
      background: mode === 'dark' ? '#101114' : '#f6f7f9',
      color: mode === 'dark' ? '#e5e7eb' : '#374151'
    }"
  >
    <header
      class="flex h-16 items-center justify-between border-b px-7"
      :style="{ borderColor: mode === 'dark' ? '#292b30' : '#e5e7eb' }"
    >
      <AppBrand :appearance="appearance" />
      <span class="text-xs opacity-50">App preview</span>
    </header>
    <div class="px-7 py-10">
      <p class="text-sm opacity-50">Your workspace</p>
      <h2 class="mt-2 text-2xl font-semibold tracking-tight">
        {{ appearance.displayName }}
      </h2>
    </div>
    <div ref="host" data-widget-preview />
  </div>
  <Teleport v-if="content" :to="content"><slot /></Teleport>
</template>
