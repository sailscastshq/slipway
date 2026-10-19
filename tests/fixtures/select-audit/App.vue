<script setup>
import { ref } from 'vue'
import BareSelect from '@/components/BareSelect.vue'
import Recipients from '@/components/bridge/BridgeActionMultiselect.vue'
const currency = ref('usd')
const selected = ref([])
const choices = [
  { value: 'usd', label: 'USD' },
  { value: 'eur', label: 'EUR' },
  { value: 'gbp', label: 'GBP', disabled: true }
]
</script>
<template>
  <main class="mx-auto max-w-3xl space-y-8 p-6 text-gray-900 dark:text-white">
    <header>
      <p class="text-sm text-gray-500">Slipway · synthetic fixture</p>
      <h1 class="text-2xl font-semibold">Select controls</h1>
      <p class="mt-2 text-sm">
        Shared fields, validation and recipient search. No live data.
      </p>
    </header>
    <form class="space-y-6">
      <label class="block text-sm"
        >Currency<BareSelect
          id="currency"
          name="currency"
          v-model="currency"
          :options="choices"
          class="min-h-11 w-full px-1"
        >
          <template #value="{ option }"
            ><span data-test="selected-value">{{
              option.label
            }}</span></template
          >
        </BareSelect></label
      ><label class="block text-sm"
        >Disabled<BareSelect
          id="disabled"
          disabled
          :model-value="'usd'"
          :options="choices"
          class="min-h-11 w-full px-1" /></label
      ><label class="block text-sm"
        >Backup interval<BareSelect
          id="invalid"
          aria-invalid="true"
          aria-describedby="error"
          placeholder="Choose an interval"
          :options="choices"
          class="min-h-11 w-full px-1"
        />
        <p id="error" class="mt-1 text-red-500">
          Choose an interval before saving.
        </p></label
      >
      <div class="block text-sm">
        <label for="recipients">Recipients</label
        ><Recipients
          id="recipients"
          v-model="selected"
          search-url="/fixture/people"
        />
      </div>
      <button id="next" type="button" class="text-sm">Next field</button>
    </form>
  </main>
</template>
