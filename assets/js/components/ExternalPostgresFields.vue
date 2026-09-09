<script setup>
import Input from '@/components/ui/input/Input.vue'
import Select from '@/components/ui/select/Select.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
import Alert from '@/components/ui/alert/Alert.vue'
const model = defineModel({ required: true })
const field =
  'focus:border-brand w-full rounded-none border-0 border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:outline-none dark:border-gray-700 dark:text-white'
</script>
<template>
  <div class="space-y-4" data-test="external-postgresql-fields">
    <div>
      <label
        for="external-postgres-dsn"
        class="mb-1 block text-xs text-gray-500"
        >PostgreSQL connection URL</label
      >
      <Input
        id="external-postgres-dsn"
        v-model="model.dsn"
        type="password"
        autocomplete="new-password"
        placeholder="postgresql://user:password@host/database"
        :class="field"
      />
    </div>
    <div>
      <label
        for="external-postgres-tls"
        class="mb-1 block text-xs text-gray-500"
        >TLS</label
      >
      <Select
        id="external-postgres-tls"
        v-model="model.sslMode"
        :options="[
          { value: 'verify-full', label: 'Verify certificate and hostname' },
          { value: 'require', label: 'Encrypt without verifying identity' },
          { value: 'disable', label: 'No encryption' }
        ]"
        :class="field"
      />
    </div>
    <Alert
      v-if="model.sslMode !== 'verify-full'"
      class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
    >
      <p>
        {{
          model.sslMode === 'disable'
            ? 'This sends database credentials and data without encryption.'
            : 'This encrypts traffic but does not verify the database server’s identity.'
        }}
      </p>
      <label class="mt-2 flex items-center gap-2"
        ><Checkbox v-model="model.allowInsecure" /> I understand this connection
        risk</label
      >
    </Alert>
    <details v-else>
      <summary class="cursor-pointer text-sm text-gray-600 dark:text-gray-400">
        Custom CA certificate
      </summary>
      <label for="external-postgres-ca" class="mt-3 block text-xs text-gray-500"
        >PEM certificate (optional)</label
      >
      <Textarea
        id="external-postgres-ca"
        v-model="model.caCertificate"
        rows="4"
        :class="field"
      />
      <p class="mt-1 text-xs text-gray-500">
        Applications receive the certificate in a managed CA variable; configure
        the app’s database adapter to use it.
      </p>
    </details>
  </div>
</template>
