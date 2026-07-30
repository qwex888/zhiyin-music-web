<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { X } from 'lucide-vue-next';

const props = defineProps<{
  modelValue: string[];
  suggestions?: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const { t } = useI18n();
const customInput = ref('');

const selected = computed(() => props.modelValue);
const suggestionList = computed(() =>
  (props.suggestions ?? []).filter(
    (name) => !selected.value.some((s) => s.toLowerCase() === name.toLowerCase()),
  ),
);

const setSelected = (next: string[]) => {
  emit('update:modelValue', next);
};

const toggle = (name: string) => {
  const exists = selected.value.some((s) => s.toLowerCase() === name.toLowerCase());
  if (exists) {
    setSelected(selected.value.filter((s) => s.toLowerCase() !== name.toLowerCase()));
  } else {
    setSelected([...selected.value, name]);
  }
};

const remove = (name: string) => {
  setSelected(selected.value.filter((s) => s !== name));
};

const addCustom = () => {
  const parts = customInput.value
    .split(/[;|,/、，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return;
  const next = [...selected.value];
  for (const p of parts) {
    if (!next.some((s) => s.toLowerCase() === p.toLowerCase())) {
      next.push(p);
    }
  }
  setSelected(next);
  customInput.value = '';
};
</script>

<template>
  <div class="space-y-2">
    <div v-if="selected.length" class="flex flex-wrap gap-1.5">
      <button
        v-for="name in selected"
        :key="name"
        type="button"
        class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/15 text-primary border border-primary/30"
        @click="remove(name)"
      >
        {{ name }}
        <X class="w-3 h-3" />
      </button>
    </div>

    <div v-if="suggestionList.length" class="flex flex-wrap gap-1.5">
      <button
        v-for="name in suggestionList"
        :key="name"
        type="button"
        class="px-2.5 py-1 rounded-full text-xs font-medium bg-bg-elevate text-text-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors"
        @click="toggle(name)"
      >
        {{ name }}
      </button>
    </div>

    <div class="flex gap-2">
      <input
        v-model="customInput"
        type="text"
        class="flex-1 min-w-0 p-2 rounded-lg bg-bg-elevate border border-border text-sm text-text-primary"
        :placeholder="t('genres.genres_placeholder')"
        @keydown.enter.prevent="addCustom"
      />
      <button
        type="button"
        class="px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-elevate border border-border text-text-secondary hover:text-primary shrink-0"
        @click="addCustom"
      >
        {{ t('genres.add') }}
      </button>
    </div>
  </div>
</template>
