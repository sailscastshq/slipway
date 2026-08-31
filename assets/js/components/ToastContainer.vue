<script setup>
import Check from '@/components/ui/icons/Check.vue'
import InfoCircle from '@/components/ui/icons/InfoCircle.vue'
import X from '@/components/ui/icons/X.vue'
import Toast from '@/components/ui/toast/Toast.vue'
import DeploymentToast from '@/components/DeploymentToast.vue'
import ServiceActionToast from '@/components/ServiceActionToast.vue'

const props = defineProps({
  controller: { type: Function, required: true }
})

const emit = defineEmits(['deployment-status-change', 'dismiss-deployment'])

const icons = {
  success: Check,
  error: X,
  info: InfoCircle
}

const colors = {
  success: 'text-green-500 dark:text-green-400',
  error: 'text-red-500 dark:text-red-400',
  info: 'text-blue-500 dark:text-blue-400'
}

function dismissDeployment(item, dismiss) {
  dismiss()
  emit('dismiss-deployment', item.deployment.id)
}

function activateAction(item, event, dismiss) {
  item.action?.onClick?.(event, item)
  dismiss()
}
</script>

<template>
  <Toast
    :controller="props.controller"
    position="bottom-right"
    from="right"
    to="right"
    class="max-h-[calc(100dvh-2rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain"
  >
    <template #default="{ item, dismiss }">
      <DeploymentToast
        v-if="item.kind === 'deployment'"
        :deployment="item.deployment"
        @status-change="emit('deployment-status-change', $event)"
        @dismiss="dismissDeployment(item, dismiss)"
      />
      <ServiceActionToast
        v-else-if="item.kind === 'service-action'"
        :action="item.action"
        @dismiss="dismiss"
      />
      <template v-else>
        <component
          :is="icons[item.type] || icons.success"
          class="mt-0.5 h-5 w-5 shrink-0"
          :class="colors[item.type] || colors.success"
          stroke-width="2"
        />
        <p
          v-if="!item.title && !item.action?.label"
          class="flex-1 text-sm text-gray-900 dark:text-white"
        >
          {{ item.message }}
        </p>
        <div v-else class="min-w-0 flex-1">
          <p
            v-if="item.title"
            class="text-sm font-medium text-gray-900 dark:text-white"
          >
            {{ item.title }}
          </p>
          <p
            v-if="item.message"
            :class="[
              'text-sm text-gray-900 dark:text-white',
              item.title && 'mt-0.5 text-gray-600 dark:text-gray-300'
            ]"
          >
            {{ item.message }}
          </p>
          <a
            v-if="item.action?.href"
            :href="item.action.href"
            class="min-h-8 mt-2 inline-flex items-center text-sm font-semibold text-gray-900 underline decoration-gray-300 underline-offset-4 hover:decoration-current focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 dark:text-white dark:decoration-gray-600 dark:focus-visible:ring-white"
            @click="activateAction(item, $event, dismiss)"
          >
            {{ item.action.label }}
          </a>
          <button
            v-else-if="item.action?.label"
            type="button"
            class="min-h-8 mt-2 inline-flex cursor-pointer items-center text-sm font-semibold text-gray-900 hover:text-gray-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 dark:text-white dark:hover:text-gray-300 dark:focus-visible:ring-white"
            @click="activateAction(item, $event, dismiss)"
          >
            {{ item.action.label }}
          </button>
        </div>
        <button
          v-if="item.dismissible !== false"
          type="button"
          class="shrink-0 cursor-pointer text-gray-400 hover:text-gray-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 dark:hover:text-gray-300 dark:focus-visible:ring-white"
          :aria-label="
            item.dismissLabel ||
            `Dismiss ${item.title || item.message || 'notification'}`
          "
          @click="dismiss"
        >
          <X class="h-4 w-4" stroke-width="2" />
        </button>
      </template>
    </template>
  </Toast>
</template>
