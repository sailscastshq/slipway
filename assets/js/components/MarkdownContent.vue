<script setup>
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

const props = defineProps({
  source: { type: String, default: '' }
})

const safeHtml = computed(() =>
  DOMPurify.sanitize(
    marked.parse(props.source, {
      gfm: true,
      breaks: false
    }),
    {
      ALLOWED_TAGS: [
        'a',
        'blockquote',
        'br',
        'code',
        'del',
        'em',
        'h1',
        'h2',
        'h3',
        'h4',
        'hr',
        'img',
        'li',
        'ol',
        'p',
        'pre',
        'strong',
        'ul'
      ],
      ALLOWED_ATTR: ['alt', 'href', 'loading', 'src', 'title'],
      ALLOW_DATA_ATTR: false
    }
  )
)
</script>

<template>
  <div class="bearing-markdown" v-html="safeHtml"></div>
</template>

<style scoped>
.bearing-markdown {
  color: var(--color-gray-700);
  font-size: 1rem;
  line-height: 1.8;
}

.bearing-markdown :deep(p),
.bearing-markdown :deep(ul),
.bearing-markdown :deep(ol),
.bearing-markdown :deep(blockquote),
.bearing-markdown :deep(pre) {
  margin: 1.15rem 0;
}

.bearing-markdown :deep(h1),
.bearing-markdown :deep(h2),
.bearing-markdown :deep(h3),
.bearing-markdown :deep(h4) {
  color: var(--color-gray-950);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.bearing-markdown :deep(h1) {
  margin: 2.5rem 0 1rem;
  font-size: 1.75rem;
}

.bearing-markdown :deep(h2) {
  margin: 2.35rem 0 0.9rem;
  font-size: 1.45rem;
}

.bearing-markdown :deep(h3) {
  margin: 2rem 0 0.75rem;
  font-size: 1.2rem;
}

.bearing-markdown :deep(h4) {
  margin: 1.75rem 0 0.65rem;
  font-size: 1rem;
}

.bearing-markdown :deep(ul),
.bearing-markdown :deep(ol) {
  padding-left: 1.35rem;
}

.bearing-markdown :deep(ul) {
  list-style: disc;
}

.bearing-markdown :deep(ol) {
  list-style: decimal;
}

.bearing-markdown :deep(li) {
  margin: 0.45rem 0;
  padding-left: 0.2rem;
}

.bearing-markdown :deep(a) {
  color: var(--color-gray-950);
  font-weight: 500;
  text-decoration: underline;
  text-decoration-color: var(--color-gray-300);
  text-underline-offset: 0.2em;
}

.bearing-markdown :deep(strong) {
  color: var(--color-gray-950);
  font-weight: 600;
}

.bearing-markdown :deep(blockquote) {
  border-left: 2px solid var(--color-gray-300);
  color: var(--color-gray-500);
  padding-left: 1.2rem;
}

.bearing-markdown :deep(code) {
  border-radius: 0.35rem;
  background: var(--color-gray-100);
  padding: 0.15rem 0.35rem;
  font-size: 0.9em;
}

.bearing-markdown :deep(pre) {
  overflow-x: auto;
  border-radius: 0.85rem;
  background: var(--color-gray-950);
  color: var(--color-gray-100);
  padding: 1rem 1.15rem;
}

.bearing-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}

.bearing-markdown :deep(img) {
  margin: 2rem 0;
  max-height: 40rem;
  width: 100%;
  border-radius: 0.9rem;
  object-fit: cover;
}

.bearing-markdown :deep(hr) {
  margin: 2.5rem auto;
  width: 4rem;
  border: 0;
  border-top: 1px solid var(--color-gray-200);
}

@media (prefers-color-scheme: dark) {
  .bearing-markdown {
    color: var(--color-gray-300);
  }

  .bearing-markdown :deep(h1),
  .bearing-markdown :deep(h2),
  .bearing-markdown :deep(h3),
  .bearing-markdown :deep(h4),
  .bearing-markdown :deep(strong),
  .bearing-markdown :deep(a) {
    color: var(--color-gray-50);
  }

  .bearing-markdown :deep(a) {
    text-decoration-color: var(--color-gray-700);
  }

  .bearing-markdown :deep(blockquote) {
    border-color: var(--color-gray-700);
    color: var(--color-gray-400);
  }

  .bearing-markdown :deep(code) {
    background: var(--color-gray-800);
  }

  .bearing-markdown :deep(pre) {
    background: var(--color-gray-900);
  }

  .bearing-markdown :deep(hr) {
    border-color: var(--color-gray-800);
  }
}
</style>
