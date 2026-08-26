import { onBeforeUnmount, onMounted, ref } from 'vue'
import { readScroll, writeScroll } from './core.js'

export function useScrollRestoration(key, options = {}) {
  const restored = ref(false)
  let previousRestoration
  let frame

  function target() {
    const candidate =
      typeof options.target === 'function' ? options.target() : options.target
    return candidate?.value ?? candidate ?? window
  }

  function capture() {
    const node = target()
    writeScroll(
      key,
      {
        x: node === window ? window.scrollX : node.scrollLeft,
        y: node === window ? window.scrollY : node.scrollTop
      },
      options
    )
  }

  function restore(attempt = 0) {
    const hasHash = Boolean(location.hash)
    const hashTarget = hasHash && document.querySelector(location.hash)
    if (hashTarget) hashTarget.scrollIntoView()
    else if (hasHash && attempt < (options.hashAttempts ?? 60)) {
      frame = requestAnimationFrame(() => restore(attempt + 1))
      return
    } else {
      const position = readScroll(key, options)
      if (position) target().scrollTo(position.x, position.y)
    }
    restored.value = true
  }

  onMounted(() => {
    previousRestoration = history.scrollRestoration
    history.scrollRestoration = 'manual'
    addEventListener('pagehide', capture)
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => restore())
    })
  })
  onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    capture()
    removeEventListener('pagehide', capture)
    if (previousRestoration) history.scrollRestoration = previousRestoration
  })

  return { capture, restore, restored }
}
