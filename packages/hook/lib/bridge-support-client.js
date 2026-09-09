;(function () {
  const start = document.body.dataset.slipwaySupportStart
  if (start) {
    if (
      getComputedStyle(document.getElementById('slipway-support-banner'))
        .position !== 'fixed'
    )
      return
    const code = location.hash.slice(1)
    history.replaceState(null, '', location.pathname)
    if (!/^[a-f0-9]{64}$/.test(code)) return
    fetch(start + '/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    })
      .then(async (response) => {
        if (!response.ok) throw Error()
        const data = await response.json()
        location.replace(data.location)
      })
      .catch(() => {
        document.getElementById('slipway-support-message').textContent =
          'The support view could not start. Return to Bridge and try again.'
      })
    return
  }
  const banner = document.getElementById('slipway-support-banner')
  if (!banner) return
  const root = banner.dataset.root
  let stopped = false
  function stop() {
    if (!stopped) {
      stopped = true
      location.replace(root + '/stop')
    }
  }
  function visible() {
    if (
      !banner.isConnected ||
      getComputedStyle(banner).position !== 'fixed' ||
      banner.getBoundingClientRect().height < 24 ||
      getComputedStyle(banner).visibility === 'hidden' ||
      getComputedStyle(banner).opacity === '0'
    )
      return stop()
    const remaining = Number(banner.dataset.expires) - Date.now()
    if (remaining <= 0) return stop()
    banner.querySelector('[data-support-time]').textContent =
      Math.ceil(remaining / 60000) + ' min remaining'
    document.documentElement.style.paddingTop =
      banner.getBoundingClientRect().height + 'px'
  }
  visible()
  setInterval(visible, 1000)
  setInterval(
    () =>
      fetch(root + '/status', { cache: 'no-store' })
        .then((r) => r.json())
        .then((state) => {
          if (!state.active) stop()
        })
        .catch(stop),
    10000
  )
  document.addEventListener(
    'submit',
    (event) => {
      event.preventDefault()
    },
    true
  )
})()
