<script setup>
import Textarea from '@/components/ui/textarea/Textarea.vue'
import Input from '@/components/ui/input/Input.vue'
import Radio from '@/components/ui/radio/Radio.vue'
import { Head, InfiniteScroll, router, useForm } from '@inertiajs/vue3'
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch
} from 'vue'
import ShareLinkButton from '@/components/ShareLinkButton.vue'
import Select from '@/components/ui/select/Select.vue'
import Tooltip from '@/components/ui/tooltip/Tooltip.vue'
import FileUpload from '@/components/ui/file-upload/FileUpload.vue'
import { useBearingRealtime } from '@/composables/useBearingRealtime'
import { useFormDraft } from '@/composables/useFormDraft'

const props = defineProps({
  app: Object,
  bearing: Object,
  participant: Object,
  viewer: Object,
  embedded: Boolean,
  realtime: Object,
  focusedFeedbackId: String,
  feedbackLoadedAt: Number,
  filters: Object,
  feedback: Object
})

const canSubmit = computed(
  () =>
    props.bearing.acceptFeedback &&
    (props.participant || props.bearing.allowAnonymousParticipation)
)
const categories = computed(() => props.bearing.categories || [])
const activeCategories = computed(() =>
  categories.value.filter((category) => category.active)
)
const categoryOptions = computed(() =>
  activeCategories.value.map((category) => ({
    value: category.key,
    label: category.label
  }))
)
const statusOptions = [
  { value: 'active', label: 'Active feedback' },
  { value: 'all', label: 'Any status' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'closed', label: 'Closed' }
]
const IMAGE_FIELDS = ['image0', 'image1', 'image2', 'image3']
const ACCEPTED_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const attachedImages = shallowRef([])
const form = useForm({
  category: activeCategories.value[0]?.key || 'feature',
  title: '',
  details: '',
  image0: null,
  image1: null,
  image2: null,
  image3: null
})
form.transform((data) => ({
  ...Object.fromEntries(
    Object.entries(data).filter(
      ([field, value]) => !IMAGE_FIELDS.includes(field) || isImageFile(value)
    )
  ),
  imageCount: attachedImages.value.length
}))
const canShare = computed(() => Boolean(form.title.trim()) && !form.processing)
const { clear: clearDraft, restored: draftRestored } = useFormDraft(
  `slipway.bearing.feedback-draft.${props.app.feedbackPath}`,
  form,
  { exclude: IMAGE_FIELDS }
)
const search = ref(props.filters.q)
const categoryFilter = ref(props.filters.category)
const statusFilter = ref(props.filters.status)
const sort = ref(props.filters.sort)
const mobileFiltersDialog = ref(null)
const titleInput = ref(null)
const feedbackItems = ref([...(props.feedback?.data || [])])
const highlightedFeedback = ref(new Set())
const votingFeedback = ref(new Set())
const liveAnnouncement = ref('')
const filtersLoading = ref(false)
const highlightTimers = new Map()
let filterTimer
let serverFilterSignature = filterSignature(props.filters)
let applyingServerFilters = false
let realtimeCursor = props.feedbackLoadedAt

const visibleFeedback = computed(() => {
  const query = search.value.trim().toLowerCase()
  return [...feedbackItems.value]
    .filter(
      (item) =>
        item.publicId === props.focusedFeedbackId ||
        categoryFilter.value === 'all' ||
        item.category === categoryFilter.value
    )
    .filter((item) => {
      if (item.publicId === props.focusedFeedbackId) return true
      if (statusFilter.value === 'all') return true
      if (statusFilter.value === 'active') return item.status !== 'closed'
      return item.status === statusFilter.value
    })
    .filter(
      (item) =>
        item.publicId === props.focusedFeedbackId ||
        !query ||
        item.title.toLowerCase().includes(query) ||
        item.details?.toLowerCase().includes(query)
    )
    .sort((a, b) =>
      sort.value === 'newest'
        ? new Date(b.createdAt) - new Date(a.createdAt)
        : b.voteCount - a.voteCount ||
          new Date(b.createdAt) - new Date(a.createdAt)
    )
})

const focusedFeedback = computed(() =>
  feedbackItems.value.find((item) => item.publicId === props.focusedFeedbackId)
)
const pageTitle = computed(() =>
  focusedFeedback.value
    ? `${focusedFeedback.value.title} · ${props.app.name}`
    : `Feedback · ${props.app.name}`
)
const pageDescription = computed(
  () =>
    focusedFeedback.value?.details ||
    `Share feedback and help shape what comes next for ${props.app.name}.`
)

const { state: realtimeState } = useBearingRealtime(props.realtime, {
  onSnapshot: reconcileFeedback,
  onEvent: receiveFeedbackEvent
})

const summaryPlaceholder = computed(() =>
  form.category === 'bug' ? 'Describe the problem' : 'Describe your idea'
)
const participantName = computed(
  () => props.participant?.displayName || 'Anonymous'
)
const participantInitials = computed(() =>
  participantName.value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
)
const activeFilterCount = computed(
  () =>
    Number(categoryFilter.value !== 'all') +
    Number(statusFilter.value !== 'active') +
    Number(sort.value !== 'top')
)

watch(draftRestored, () => {
  if (!activeCategories.value.some((item) => item.key === form.category)) {
    form.category = activeCategories.value[0]?.key || 'feature'
  }
})

watch(search, () => {
  if (applyingServerFilters) return
  window.clearTimeout(filterTimer)
  filterTimer = window.setTimeout(refreshFeedback, 250)
})

watch([categoryFilter, statusFilter, sort], () => {
  if (applyingServerFilters) return
  window.clearTimeout(filterTimer)
  refreshFeedback()
})

watch(
  [() => props.feedback?.data, () => filterSignature(props.filters)],
  async ([items, nextSignature]) => {
    const reset = nextSignature !== serverFilterSignature
    serverFilterSignature = nextSignature
    synchronizeLoadedFeedback(items || [], { reset })

    if (filterSignatureFromState() !== nextSignature) {
      applyingServerFilters = true
      search.value = props.filters.q
      categoryFilter.value = props.filters.category
      statusFilter.value = props.filters.status
      sort.value = props.filters.sort
      await nextTick()
      applyingServerFilters = false
    }
  },
  { deep: true }
)

watch(
  () => props.feedbackLoadedAt,
  (loadedAt) => {
    realtimeCursor = loadedAt
  }
)

onMounted(revealFocusedFeedback)

onUnmounted(() => {
  window.clearTimeout(filterTimer)
  for (const timer of highlightTimers.values()) window.clearTimeout(timer)
})

function reconcileFeedback(snapshot, syncedAt) {
  const previous = new Map(
    feedbackItems.value.map((item) => [item.publicId, item])
  )
  const snapshotById = new Map(snapshot.map((item) => [item.publicId, item]))
  const newSincePageLoad = snapshot.filter(
    (item) =>
      !previous.has(item.publicId) &&
      new Date(item.createdAt).getTime() >= realtimeCursor
  )
  const refreshedLoadedFeedback = feedbackItems.value.map((item) =>
    mergeFeedbackItem(item, snapshotById.get(item.publicId) || item)
  )
  feedbackItems.value = [...newSincePageLoad, ...refreshedLoadedFeedback]
  realtimeCursor = syncedAt

  for (const item of feedbackItems.value) {
    const existing = previous.get(item.publicId)
    if (!existing || feedbackChanged(existing, item)) {
      highlightFeedback(item.publicId)
    }
  }
}

function synchronizeLoadedFeedback(items, { reset = false } = {}) {
  if (reset) {
    feedbackItems.value = [...items]
    return
  }

  const incomingIds = new Set(items.map((item) => item.publicId))
  const liveOnly = feedbackItems.value.filter(
    (item) => !incomingIds.has(item.publicId)
  )
  const current = new Map(
    feedbackItems.value.map((item) => [item.publicId, item])
  )
  const loaded = items.map((item) =>
    newestFeedback(current.get(item.publicId), item)
  )
  feedbackItems.value = [...liveOnly, ...loaded]
}

function newestFeedback(current, incoming) {
  if (!current) return incoming
  const newest =
    new Date(incoming.updatedAt).getTime() >=
    new Date(current.updatedAt).getTime()
      ? incoming
      : current
  return mergeFeedbackItem(current, newest)
}

function receiveFeedbackEvent(event) {
  if (!event?.feedback?.publicId) return
  const publicId = event.feedback.publicId

  if (event.verb === 'removed') {
    feedbackItems.value = feedbackItems.value.filter(
      (item) => item.publicId !== publicId
    )
    liveAnnouncement.value = 'Feedback removed.'
    return
  }

  const existingIndex = feedbackItems.value.findIndex(
    (item) => item.publicId === publicId
  )
  if (existingIndex === -1) {
    feedbackItems.value = [event.feedback, ...feedbackItems.value]
    liveAnnouncement.value = 'New feedback received.'
  } else {
    feedbackItems.value = feedbackItems.value.map((item, index) =>
      index === existingIndex ? mergeFeedbackItem(item, event.feedback) : item
    )
    liveAnnouncement.value = 'Feedback updated.'
  }
  highlightFeedback(publicId)
}

function highlightFeedback(publicId) {
  window.clearTimeout(highlightTimers.get(publicId))
  highlightedFeedback.value = new Set([...highlightedFeedback.value, publicId])
  highlightTimers.set(
    publicId,
    window.setTimeout(() => {
      const next = new Set(highlightedFeedback.value)
      next.delete(publicId)
      highlightedFeedback.value = next
      highlightTimers.delete(publicId)
    }, 2400)
  )
}

function feedbackChanged(previous, next) {
  return ['title', 'details', 'category', 'status', 'voteCount'].some(
    (field) => previous[field] !== next[field]
  )
}

async function revealFocusedFeedback() {
  if (!props.focusedFeedbackId || !focusedFeedback.value) return
  await nextTick()
  const card = document.getElementById(
    `bearing-feedback-${props.focusedFeedbackId}`
  )
  if (!card) return

  card.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth',
    block: 'center'
  })
  highlightFeedback(props.focusedFeedbackId)
}

function feedbackPermalink(item) {
  return `${props.app.feedbackPath}/${encodeURIComponent(item.publicId)}`
}

function mergeFeedbackItem(current, incoming) {
  if (!incoming) return current
  if (!current || Object.hasOwn(incoming, 'viewerHasVoted')) return incoming
  return { ...incoming, viewerHasVoted: current.viewerHasVoted === true }
}

async function toggleVote(item) {
  if (!props.viewer?.canVote) {
    window.location.assign(props.app.identityPath)
    return
  }
  if (votingFeedback.value.has(item.publicId)) return

  const wasVoted = item.viewerHasVoted === true
  votingFeedback.value = new Set([...votingFeedback.value, item.publicId])
  replaceFeedback(item.publicId, {
    viewerHasVoted: !wasVoted,
    voteCount: Math.max(0, item.voteCount + (wasVoted ? -1 : 1))
  })

  try {
    const response = await fetch(
      `${props.app.feedbackPath}/${encodeURIComponent(item.publicId)}/vote`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      }
    )
    if (response.status === 403) {
      window.location.assign(props.app.identityPath)
      return
    }
    if (!response.ok) throw new Error('Vote failed')
    const result = await response.json()
    replaceFeedback(item.publicId, {
      viewerHasVoted: result.voted === true,
      voteCount: result.voteCount
    })
    liveAnnouncement.value = result.voted ? 'Vote added.' : 'Vote removed.'
  } catch {
    replaceFeedback(item.publicId, {
      viewerHasVoted: wasVoted,
      voteCount: item.voteCount
    })
    liveAnnouncement.value = 'Your vote could not be saved. Try again.'
  } finally {
    const next = new Set(votingFeedback.value)
    next.delete(item.publicId)
    votingFeedback.value = next
  }
}

function replaceFeedback(publicId, values) {
  feedbackItems.value = feedbackItems.value.map((feedback) =>
    feedback.publicId === publicId ? { ...feedback, ...values } : feedback
  )
}

function refreshFeedback() {
  const query = {}
  if (search.value.trim()) query.q = search.value.trim()
  if (categoryFilter.value !== 'all') query.category = categoryFilter.value
  if (statusFilter.value !== 'active') query.status = statusFilter.value
  if (sort.value !== 'top') query.sort = sort.value

  router.get(props.app.feedbackPath, query, {
    only: ['feedback', 'feedbackLoadedAt', 'filters', 'focusedFeedbackId'],
    reset: ['feedback'],
    preserveState: true,
    preserveScroll: true,
    replace: true,
    onStart: () => {
      filtersLoading.value = true
    },
    onFinish: () => {
      filtersLoading.value = false
    }
  })
}

function filterSignature(filters) {
  return JSON.stringify([
    filters?.q || '',
    filters?.category || 'all',
    filters?.status || 'active',
    filters?.sort || 'top'
  ])
}

function filterSignatureFromState() {
  return filterSignature({
    q: search.value,
    category: categoryFilter.value,
    status: statusFilter.value,
    sort: sort.value
  })
}

function submit() {
  if (!form.title.trim()) {
    form.setError('title', 'Add a short title for your feedback.')
    titleInput.value?.focus()
    return
  }

  form.post(props.app.feedbackPath, {
    preserveScroll: true,
    onSuccess: () => {
      clearDraft()
      clearSelectedImages()
      form.reset()
    }
  })
}

function handleTitleInput() {
  if (form.errors.title) form.clearErrors('title')
}

function discardDraft() {
  clearSelectedImages()
  form.reset()
  clearDraft()
}

function handleImagePaste(event) {
  const files = Array.from(event.clipboardData?.items || [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean)
  if (!files.length) return
  event.preventDefault()
  addPastedImages(files)
}

function addPastedImages(fileList) {
  const incoming = Array.from(fileList || [])
  if (!incoming.length) return

  form.clearErrors('images')
  const accepted = [...attachedImages.value]
  let rejection = ''

  for (const file of incoming) {
    const result = validateImage(file, { files: accepted })
    if (result === true) {
      accepted.push(file)
    } else {
      rejection = typeof result === 'string' ? result : result.message
    }
  }

  if (accepted.length !== attachedImages.value.length) {
    attachedImages.value = accepted
    handleImagesChange(accepted)
  }
  if (rejection) {
    form.setError('images', rejection)
    liveAnnouncement.value = rejection
  }
}

function validateImage(file, { files }) {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return 'Choose AVIF, GIF, JPEG, PNG, or WebP images.'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'Each image must be 5 MB or smaller.'
  }
  if (
    files.some(
      (candidate) => imageSignature(candidate) === imageSignature(file)
    )
  ) {
    return { reason: 'duplicate', message: 'That image is already attached.' }
  }
  if (files.length >= IMAGE_FIELDS.length) {
    return `You can attach up to ${IMAGE_FIELDS.length} images.`
  }
  return true
}

function handleImagesChange(files) {
  syncImageFields(files)
  form.clearErrors('images')
  liveAnnouncement.value = `${files.length} ${
    files.length === 1 ? 'image' : 'images'
  } attached.`
}

function handleImageReject(rejection) {
  const message =
    rejection.reason === 'accept'
      ? 'Choose AVIF, GIF, JPEG, PNG, or WebP images.'
      : rejection.message
  nextTick(() => {
    form.setError('images', message)
    liveAnnouncement.value = message
  })
}

function syncImageFields(files) {
  for (const imageField of IMAGE_FIELDS) form[imageField] = null
  files.slice(0, IMAGE_FIELDS.length).forEach((file, index) => {
    form[IMAGE_FIELDS[index]] = file
  })
}

function removeImage(upload, file) {
  upload.remove(file)
  form.clearErrors('images')
  liveAnnouncement.value = 'Image removed.'
}

function clearSelectedImages() {
  attachedImages.value = []
  syncImageFields([])
  form.clearErrors('images')
}

function imageSignature(file) {
  return [file.name, file.size, file.type, file.lastModified].join(':')
}

function isImageFile(value) {
  return typeof File !== 'undefined' && value instanceof File
}

function openMobileFilters() {
  mobileFiltersDialog.value?.showModal()
}

function closeMobileFilters() {
  mobileFiltersDialog.value?.close()
}

function closeMobileFiltersFromBackdrop(event) {
  if (event.target === event.currentTarget) closeMobileFilters()
}

function resetMobileFilters() {
  categoryFilter.value = 'all'
  statusFilter.value = 'active'
  sort.value = 'top'
}

function statusLabel(status) {
  return {
    reviewing: 'Reviewing',
    planned: 'Planned',
    in_progress: 'In progress',
    shipped: 'Shipped',
    closed: 'Closed'
  }[status]
}

function categoryLabel(categoryKey) {
  return (
    categories.value.find((category) => category.key === categoryKey)?.label ||
    'Feedback'
  )
}

function shortDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(value))
}
</script>

<template>
  <Head :title="pageTitle">
    <meta
      head-key="description"
      name="description"
      :content="pageDescription"
    />
    <meta
      head-key="og:type"
      property="og:type"
      :content="focusedFeedback ? 'article' : 'website'"
    />
    <meta head-key="og:site_name" property="og:site_name" :content="app.name" />
    <meta head-key="og:title" property="og:title" :content="pageTitle" />
    <meta
      head-key="og:description"
      property="og:description"
      :content="pageDescription"
    />
    <meta head-key="og:url" property="og:url" :content="app.publicUrl" />
    <meta head-key="og:image" property="og:image" :content="app.ogImageUrl" />
    <meta head-key="og:image:width" property="og:image:width" content="1200" />
    <meta head-key="og:image:height" property="og:image:height" content="630" />
    <meta
      head-key="twitter:card"
      name="twitter:card"
      content="summary_large_image"
    />
    <meta head-key="twitter:title" name="twitter:title" :content="pageTitle" />
    <meta
      head-key="twitter:description"
      name="twitter:description"
      :content="pageDescription"
    />
    <meta head-key="twitter:url" name="twitter:url" :content="app.publicUrl" />
    <meta
      head-key="twitter:image"
      name="twitter:image"
      :content="app.ogImageUrl"
    />
    <link head-key="canonical" rel="canonical" :href="app.publicUrl" />
  </Head>
  <div
    class="min-h-screen bg-white text-gray-950 dark:bg-gray-950 dark:text-white"
    :data-bearing-realtime="realtimeState"
  >
    <header v-if="!embedded" class="px-5 sm:px-8">
      <nav
        class="mx-auto flex h-16 max-w-5xl items-center justify-between"
        aria-label="Bearing"
      >
        <a :href="app.homeUrl" class="text-sm font-semibold tracking-tight">
          {{ app.name }}
        </a>
        <div class="flex items-center gap-5 text-sm">
          <a
            :href="app.feedbackPath"
            class="font-medium text-gray-950 dark:text-white"
          >
            Feedback
          </a>
          <a
            v-if="bearing.showPublicRoadmap"
            :href="app.roadmapPath"
            class="text-gray-500 transition hover:text-gray-950 dark:text-gray-400 dark:hover:text-white"
          >
            Roadmap
          </a>
          <a
            v-if="bearing.showPublicUpdates"
            :href="app.updatesPath"
            class="text-gray-500 transition hover:text-gray-950 dark:text-gray-400 dark:hover:text-white"
          >
            Updates
          </a>
        </div>
      </nav>
    </header>

    <main
      :class="
        embedded
          ? 'px-5 pb-10 pt-8 sm:px-6 sm:pt-10'
          : 'px-5 pb-20 pt-14 sm:px-8 sm:pt-20'
      "
    >
      <div class="mx-auto max-w-3xl">
        <div v-if="!embedded" class="max-w-2xl">
          <p
            class="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400"
          >
            Help shape what comes next
          </p>
          <h1 class="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Feedback
          </h1>
          <p class="mt-3 text-base leading-7 text-gray-500 dark:text-gray-400">
            Request a feature, report a bug, or tell us what would make
            {{ app.name }} better for you.
          </p>
        </div>

        <section
          :class="embedded ? 'mt-0' : 'mt-10'"
          aria-labelledby="share-feedback-heading"
        >
          <FileUpload
            v-if="canSubmit"
            v-model="attachedImages"
            multiple
            accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
            :disabled="form.processing"
            :validate="validateImage"
            @change="handleImagesChange"
            @reject="handleImageReject"
            v-slot="upload"
          >
            <form
              v-bind="upload.dropzone"
              :class="[
                'max-w-2xl transition duration-200',
                upload.dragging
                  ? '-mx-4 rounded-2xl bg-gray-50 px-4 ring-2 ring-gray-300 dark:bg-gray-900 dark:ring-gray-700'
                  : ''
              ]"
              @submit.prevent="submit"
              @paste="handleImagePaste"
              novalidate
            >
              <div>
                <h2 id="share-feedback-heading" class="sr-only">
                  Share feedback
                </h2>

                <div class="flex items-center gap-3">
                  <Tooltip :text="`Posting as ${participantName}`">
                    <span
                      role="img"
                      :aria-label="`Posting as ${participantName}`"
                      tabindex="0"
                      class="size-10 flex shrink-0 items-center justify-center rounded-full bg-gray-950 text-xs font-semibold text-white dark:bg-white dark:text-gray-950"
                    >
                      <span aria-hidden="true">{{ participantInitials }}</span>
                    </span>
                  </Tooltip>

                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    class="size-4 shrink-0 text-gray-300 dark:text-gray-700"
                    fill="none"
                  >
                    <path
                      d="m6 3.5 4.5 4.5L6 12.5"
                      stroke="currentColor"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.5"
                    />
                  </svg>

                  <div
                    class="[&_[data-slot=select-content]]:min-w-44 max-w-[16rem] [&>[data-slot=select]]:w-auto [&_[data-slot=select-content]]:rounded-xl [&_[data-slot=select-content]]:shadow-xl [&_[data-slot=select-content]]:shadow-gray-950/10 dark:[&_[data-slot=select-content]]:shadow-black/30"
                  >
                    <Select
                      id="bearing-feedback-category"
                      v-model="form.category"
                      aria-label="Category"
                      :options="categoryOptions"
                      class="min-h-10 w-auto max-w-[16rem] rounded-lg border-0 bg-gray-100 px-3.5 py-2 text-sm font-semibold text-gray-950 shadow-none hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-2 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-gray-950"
                    />
                  </div>
                </div>

                <label class="mt-7 block" for="bearing-feedback-title">
                  <span class="sr-only">Summary</span>
                  <Input
                    id="bearing-feedback-title"
                    ref="titleInput"
                    v-model="form.title"
                    type="text"
                    maxlength="140"
                    required
                    :placeholder="summaryPlaceholder"
                    :aria-invalid="Boolean(form.errors.title)"
                    :aria-describedby="
                      form.errors.title
                        ? 'bearing-feedback-title-error'
                        : undefined
                    "
                    class="bearing-feedback-composer-field w-full border-0 bg-transparent p-0 text-xl font-semibold tracking-tight text-gray-950 caret-gray-950 placeholder:font-medium placeholder:text-gray-300 dark:text-white dark:caret-white dark:placeholder:text-gray-500 sm:text-2xl"
                    @input="handleTitleInput"
                  />
                </label>

                <p
                  v-if="form.errors.title"
                  id="bearing-feedback-title-error"
                  class="mt-2 text-sm font-medium text-red-600"
                >
                  {{ form.errors.title }}
                </p>
                <p
                  v-else-if="form.title.length >= 100"
                  class="mt-2 text-xs text-gray-400"
                >
                  {{ 140 - form.title.length }} characters left
                </p>

                <label class="mt-3 block" for="bearing-feedback-details">
                  <span class="sr-only">Details (optional)</span>
                  <Textarea
                    id="bearing-feedback-details"
                    v-model="form.details"
                    rows="2"
                    maxlength="5000"
                    placeholder="Add details (optional)"
                    class="bearing-feedback-composer-field w-full resize-none border-0 bg-transparent p-0 text-sm leading-6 text-gray-700 caret-gray-950 placeholder:text-gray-300 dark:text-gray-300 dark:caret-white dark:placeholder:text-gray-600"
                  />
                </label>

                <div
                  v-if="upload.previews.length"
                  class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4"
                >
                  <figure
                    v-for="preview in upload.previews"
                    :key="imageSignature(preview.file)"
                    class="group/image relative aspect-[4/3] overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-900"
                  >
                    <img
                      :src="preview.previewUrl"
                      :alt="preview.file.name"
                      class="h-full w-full object-cover"
                    />
                    <Tooltip :text="`Remove ${preview.file.name}`">
                      <button
                        type="button"
                        :aria-label="`Remove ${preview.file.name}`"
                        class="size-8 absolute right-2 top-2 flex cursor-pointer items-center justify-center rounded-full bg-gray-950/80 text-white shadow-sm backdrop-blur transition hover:bg-gray-950 focus-visible:ring-2 focus-visible:ring-white"
                        @click="removeImage(upload, preview.file)"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 16 16"
                          class="size-3.5"
                          fill="none"
                        >
                          <path
                            d="m4.25 4.25 7.5 7.5m0-7.5-7.5 7.5"
                            stroke="currentColor"
                            stroke-linecap="round"
                            stroke-width="1.5"
                          />
                        </svg>
                      </button>
                    </Tooltip>
                  </figure>
                </div>

                <p
                  v-if="form.errors.images"
                  id="bearing-feedback-images-error"
                  role="alert"
                  class="mt-3 text-sm font-medium text-red-600"
                >
                  {{ form.errors.images }}
                </p>
              </div>

              <div
                v-if="form.progress"
                class="mt-5"
                role="status"
                aria-live="polite"
              >
                <div
                  class="flex items-center justify-between text-xs text-gray-400"
                >
                  <span>Uploading images</span>
                  <span>{{ form.progress.percentage }}%</span>
                </div>
                <div
                  class="mt-2 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-900"
                >
                  <span
                    class="block h-full rounded-full bg-gray-950 transition-[width] duration-200 dark:bg-white"
                    :style="{ width: `${form.progress.percentage}%` }"
                  ></span>
                </div>
              </div>

              <div
                class="min-h-10 mt-5 flex flex-wrap items-center justify-between gap-4"
              >
                <div
                  class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
                >
                  <button
                    type="button"
                    class="min-h-10 inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-medium text-gray-500 transition hover:bg-gray-50 hover:text-gray-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white dark:focus-visible:outline-white"
                    :aria-invalid="Boolean(form.errors.images)"
                    :aria-describedby="
                      form.errors.images
                        ? 'bearing-feedback-images-error'
                        : 'bearing-feedback-images-help'
                    "
                    @click="upload.choose"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      class="size-4"
                      fill="none"
                    >
                      <path
                        d="M3.75 5.75A2.25 2.25 0 0 1 6 3.5h8A2.25 2.25 0 0 1 16.25 5.75v8.5A2.25 2.25 0 0 1 14 16.5H6a2.25 2.25 0 0 1-2.25-2.25v-8.5Z"
                        stroke="currentColor"
                        stroke-width="1.4"
                      />
                      <path
                        d="m5.75 14 3.1-3.25 2.1 2.1 1.35-1.35 1.95 2.5M7.2 7.75h.01"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.4"
                      />
                    </svg>
                    <span>Add images</span>
                  </button>
                  <span
                    id="bearing-feedback-images-help"
                    class="text-xs text-gray-400"
                  >
                    Paste or drop · {{ upload.files.length }}/4
                  </span>
                  <p
                    v-if="draftRestored"
                    class="text-xs text-gray-500 dark:text-gray-400"
                    role="status"
                  >
                    Draft restored.
                    <button
                      type="button"
                      class="font-semibold text-gray-950 hover:underline dark:text-white"
                      @click="discardDraft"
                    >
                      Discard
                    </button>
                  </p>
                </div>

                <button
                  type="submit"
                  :disabled="!canShare"
                  :aria-busy="form.processing"
                  class="min-h-10 inline-flex shrink-0 items-center justify-center rounded-lg bg-gray-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-100 dark:focus-visible:ring-white dark:focus-visible:ring-offset-gray-950"
                >
                  {{ form.processing ? 'Sharing…' : 'Share' }}
                </button>
              </div>
            </form>
          </FileUpload>

          <div
            v-else-if="bearing.acceptFeedback"
            class="flex flex-col gap-5 rounded-2xl bg-gray-50 p-5 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between sm:p-6"
          >
            <div>
              <h2 id="share-feedback-heading" class="text-sm font-semibold">
                Have something to share?
              </h2>
              <p
                class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400"
              >
                Sign in with your {{ app.name }} account to share feedback and
                vote.
              </p>
            </div>
            <a
              :href="app.identityPath"
              class="min-h-10 inline-flex shrink-0 items-center justify-center rounded-lg bg-gray-950 px-4 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-100"
            >
              Sign in to share
            </a>
          </div>
        </section>

        <section class="mt-14" aria-labelledby="feedback-list-heading">
          <p class="sr-only" aria-live="polite" aria-atomic="true">
            {{ liveAnnouncement }}
          </p>
          <div class="flex items-end justify-between gap-5">
            <div>
              <h2 id="feedback-list-heading" class="text-base font-semibold">
                From the community
              </h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {{ visibleFeedback.length }}
                {{ visibleFeedback.length === 1 ? 'post' : 'posts' }} shown
              </p>
            </div>
          </div>

          <div
            class="mt-7 flex w-full items-center gap-2"
            aria-label="Find and filter feedback"
          >
            <label class="relative min-w-0 flex-1 sm:max-w-md">
              <span class="sr-only">Search feedback</span>
              <svg
                class="size-4 pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-gray-400"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="7"
                  cy="7"
                  r="4.25"
                  stroke="currentColor"
                  stroke-width="1.4"
                />
                <path
                  d="m10.25 10.25 3 3"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                />
              </svg>
              <Input
                v-model="search"
                type="search"
                placeholder="Find feedback…"
                class="focus:border-brand min-h-11 w-full border-0 border-b border-dashed border-gray-200 bg-transparent py-2.5 pl-7 pr-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 dark:border-gray-700 dark:text-white dark:placeholder:text-gray-500"
              />
            </label>
            <button
              type="button"
              data-test="open-mobile-feedback-filters"
              class="min-h-11 flex shrink-0 items-center gap-2 rounded-xl bg-gray-50 px-3.5 text-sm font-medium transition hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800 sm:ml-auto"
              @click="openMobileFilters"
            >
              <svg
                class="size-4 text-gray-400"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2.5 4.25h11M4.5 8h7m-5 3.75h3"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                />
              </svg>
              <span>Filter<span class="sr-only"> and sort</span></span>
              <span
                v-if="activeFilterCount"
                class="size-5 flex items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-200"
              >
                {{ activeFilterCount }}
              </span>
            </button>
          </div>

          <dialog
            ref="mobileFiltersDialog"
            class="backdrop:bg-black/35 fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85svh] w-full max-w-none rounded-t-3xl bg-white p-0 text-gray-950 shadow-2xl dark:bg-gray-950 dark:text-white sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md sm:rounded-2xl"
            aria-labelledby="mobile-feedback-filters-heading"
            @click="closeMobileFiltersFromBackdrop"
          >
            <div
              class="max-h-[85svh] overflow-y-auto px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6"
            >
              <div class="flex items-start justify-between gap-4">
                <div>
                  <h3
                    id="mobile-feedback-filters-heading"
                    class="text-base font-semibold"
                  >
                    Filter feedback
                  </h3>
                  <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {{ visibleFeedback.length }}
                    {{ visibleFeedback.length === 1 ? 'post' : 'posts' }} match
                  </p>
                </div>
                <button
                  type="button"
                  class="flex h-10 w-10 items-center justify-center rounded-lg text-xl text-gray-400 transition hover:bg-gray-50 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:text-gray-500 dark:hover:bg-gray-900 dark:hover:text-gray-200 dark:focus-visible:ring-gray-700"
                  aria-label="Close filters"
                  @click="closeMobileFilters"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>

              <label class="mt-6 block">
                <span
                  class="text-xs font-medium text-gray-500 dark:text-gray-400"
                >
                  Category
                </span>
                <Select
                  v-model="categoryFilter"
                  :options="[
                    { value: 'all', label: 'All categories' },
                    ...categories.map((category) => ({
                      value: category.key,
                      label: category.label
                    }))
                  ]"
                  data-test="bearing-feedback-category-filter"
                  class="focus:border-brand min-h-11 mt-1 w-full border-0 border-b border-dashed border-gray-300 bg-transparent px-0 text-sm focus:ring-0 dark:border-gray-700"
                />
              </label>

              <label class="mt-5 block">
                <span
                  class="text-xs font-medium text-gray-500 dark:text-gray-400"
                >
                  Status
                </span>
                <Select
                  v-model="statusFilter"
                  :options="statusOptions"
                  class="min-h-12 mt-1 w-full border-0 border-b border-dashed border-gray-300 bg-transparent px-0 text-sm focus:border-gray-950 focus:ring-0 dark:border-gray-700 dark:focus:border-white"
                />
              </label>

              <fieldset class="mt-7">
                <legend
                  class="text-xs font-medium text-gray-500 dark:text-gray-400"
                >
                  Sort
                </legend>
                <div class="mt-2 grid grid-cols-2 gap-2">
                  <label
                    v-for="option in [
                      { value: 'top', label: 'Top' },
                      { value: 'newest', label: 'Newest' }
                    ]"
                    :key="option.value"
                    class="min-h-12 flex cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium transition"
                    :class="
                      sort === option.value
                        ? 'bg-gray-100 text-gray-950 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-white dark:ring-gray-700'
                        : 'bg-gray-50/70 text-gray-500 hover:bg-gray-100 dark:bg-gray-900/60 dark:text-gray-400 dark:hover:bg-gray-900'
                    "
                  >
                    <Radio
                      v-model="sort"
                      class="sr-only"
                      name="mobile-feedback-sort"
                      :value="option.value"
                    />
                    <span>{{ option.label }}</span>
                    <svg
                      v-if="sort === option.value"
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      class="size-4 shrink-0 text-gray-600 dark:text-gray-300"
                      fill="none"
                    >
                      <path
                        d="m3.5 8 2.75 2.75L12.5 4.5"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.6"
                      />
                    </svg>
                  </label>
                </div>
              </fieldset>

              <div class="mt-8 flex items-center gap-3">
                <button
                  v-if="activeFilterCount"
                  type="button"
                  class="min-h-12 rounded-xl px-3 text-sm font-medium text-gray-500 dark:text-gray-400"
                  @click="resetMobileFilters"
                >
                  Reset
                </button>
                <button
                  type="button"
                  class="min-h-12 flex-1 rounded-xl bg-gray-950 px-4 text-sm font-medium text-white dark:bg-white dark:text-gray-950"
                  @click="closeMobileFilters"
                >
                  Show {{ visibleFeedback.length }}
                  {{ visibleFeedback.length === 1 ? 'post' : 'posts' }}
                </button>
              </div>
            </div>
          </dialog>

          <InfiniteScroll
            v-if="visibleFeedback.length"
            data="feedback"
            :buffer="500"
            :preserve-url="false"
            class="bearing-feedback-items mt-7 space-y-3"
          >
            <div v-for="item in visibleFeedback" :key="item.publicId">
              <article
                :id="`bearing-feedback-${item.publicId}`"
                class="bearing-feedback-card group flex gap-3 rounded-2xl bg-gray-50 p-5 dark:bg-gray-900 sm:gap-5 sm:p-6"
                :data-shared-focus="
                  item.publicId === focusedFeedbackId ? 'true' : undefined
                "
                :data-live-highlight="
                  highlightedFeedback.has(item.publicId) ? 'true' : undefined
                "
              >
                <button
                  type="button"
                  class="flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-white shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-2 disabled:cursor-wait dark:bg-gray-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-gray-900"
                  :class="
                    item.viewerHasVoted
                      ? 'text-gray-950 ring-1 ring-gray-300 dark:text-white dark:ring-gray-600'
                      : 'text-gray-500 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white'
                  "
                  :aria-label="`${
                    item.viewerHasVoted ? 'Remove vote from' : 'Vote for'
                  } ${item.title}. ${item.voteCount} votes`"
                  :aria-pressed="item.viewerHasVoted === true"
                  :disabled="votingFeedback.has(item.publicId)"
                  @click="toggleVote(item)"
                >
                  <svg
                    class="h-3.5 w-3.5"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="m4 9 4-4 4 4"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span class="mt-0.5 text-sm font-semibold">{{
                    item.voteCount
                  }}</span>
                </button>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2.5">
                    <h3 class="text-sm font-semibold sm:text-base">
                      <a
                        :href="feedbackPermalink(item)"
                        class="rounded-sm transition hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-2 dark:hover:text-gray-300 dark:focus-visible:ring-white dark:focus-visible:ring-offset-gray-900"
                      >
                        {{ item.title }}
                      </a>
                    </h3>
                    <span
                      data-test="bearing-feedback-category"
                      class="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                    >
                      {{ categoryLabel(item.category) }}
                    </span>
                    <span class="text-[11px] text-gray-400">{{
                      statusLabel(item.status)
                    }}</span>
                  </div>
                  <p
                    v-if="item.details"
                    class="mt-2 line-clamp-2 text-sm leading-6 text-gray-500 dark:text-gray-400"
                  >
                    {{ item.details }}
                  </p>
                  <div
                    v-if="item.images?.length"
                    :class="[
                      'mt-4 grid gap-2',
                      item.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                    ]"
                  >
                    <a
                      v-for="(image, imageIndex) in item.images"
                      :key="image.objectPath || image.url"
                      :href="image.url"
                      target="_blank"
                      rel="noreferrer"
                      class="block overflow-hidden rounded-xl bg-gray-100 focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-2 dark:bg-gray-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-gray-900"
                    >
                      <img
                        :src="image.url"
                        :alt="`${item.title} — image ${imageIndex + 1}`"
                        loading="lazy"
                        class="max-h-80 w-full object-cover transition duration-300 hover:scale-[1.015]"
                      />
                    </a>
                  </div>
                  <p class="mt-3 text-xs text-gray-400">
                    {{ item.authorName }} · {{ shortDate(item.createdAt) }}
                  </p>
                </div>
                <ShareLinkButton
                  :url="feedbackPermalink(item)"
                  :title="item.title"
                  :text="item.details || `Feedback for ${app.name}`"
                  :show-label="item.publicId === focusedFeedbackId"
                />
              </article>
            </div>

            <template #loading>
              <div
                class="flex items-center justify-center gap-2 py-8 text-sm text-gray-400"
                role="status"
                aria-live="polite"
              >
                <span class="flex gap-1" aria-hidden="true">
                  <span
                    class="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse"
                  ></span>
                  <span
                    class="h-1.5 w-1.5 rounded-full bg-current [animation-delay:120ms] motion-safe:animate-pulse"
                  ></span>
                  <span
                    class="h-1.5 w-1.5 rounded-full bg-current [animation-delay:240ms] motion-safe:animate-pulse"
                  ></span>
                </span>
                <span>Loading more feedback…</span>
              </div>
            </template>
          </InfiniteScroll>

          <div
            v-else
            class="mt-6 rounded-2xl bg-gray-50 px-6 py-12 text-center dark:bg-gray-900"
          >
            <p class="text-sm font-medium">Nothing here yet.</p>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Try a broader filter or share the first useful post.
            </p>
          </div>
        </section>

        <footer
          v-if="!embedded"
          class="mt-16 text-center text-xs text-gray-400"
        >
          <a
            href="https://docs.sailscasts.com/slipway"
            target="_blank"
            rel="noreferrer"
            class="transition hover:text-gray-600 dark:hover:text-gray-300"
          >
            Powered by Slipway
          </a>
        </footer>
      </div>
    </main>
  </div>
</template>
