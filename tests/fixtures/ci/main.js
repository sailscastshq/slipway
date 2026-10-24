// Local component review only. No job runner or production credentials.
import { createApp, h } from 'vue'
import { createInertiaApp } from '@inertiajs/vue3'
import Ci from '@/pages/projects/ci.vue'
import '../../../assets/css/app.css'
const page = await fetch('/preview-page.json').then((response) =>
  response.json()
)
await createInertiaApp({
  page,
  resolve: () => Ci,
  setup({ App, props, plugin }) {
    createApp({ render: () => h(App, props) })
      .use(plugin)
      .mount(document.body.appendChild(document.createElement('div')))
  }
})
