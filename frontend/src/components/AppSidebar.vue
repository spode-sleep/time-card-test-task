<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import {
  BellIcon,
  CalendarDaysIcon,
  HouseIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  XIcon,
} from '@lucide/vue';
const props = defineProps<{ collapsed: boolean; mobileOpen: boolean }>();
defineEmits<{ toggle: []; close: [] }>();
const navigation = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
watch(
  () => props.mobileOpen,
  async (open) => {
    await nextTick();
    if (open) closeButton.value?.focus();
    else document.getElementById('mobile-menu-trigger')?.focus();
  },
);
function keepMenuFocus(event: KeyboardEvent) {
  if (!props.mobileOpen) return;
  const controls = [
    ...(navigation.value?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    ) ?? []),
  ].filter((control) => control.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
</script>
<template>
  <button
    v-if="mobileOpen"
    class="sidebar-backdrop"
    aria-label="Закрыть меню"
    @click="$emit('close')"
  />
  <aside
    id="app-navigation"
    ref="navigation"
    class="sidebar"
    :class="{ 'is-collapsed': collapsed, 'is-mobile-open': mobileOpen }"
    aria-label="Главное меню"
    :role="mobileOpen ? 'dialog' : undefined"
    :aria-modal="mobileOpen || undefined"
    @keydown.tab="keepMenuFocus"
  >
    <div class="sidebar-brand">
      <span class="brand">CRM</span>
      <button
        class="icon-button notification-button"
        type="button"
        disabled
        aria-label="Нет новых уведомлений"
      >
        <BellIcon
          :size="17"
          :stroke-width="1.5"
        />
      </button>
      <button
        ref="closeButton"
        class="icon-button mobile-close"
        type="button"
        aria-label="Закрыть меню"
        @click="$emit('close')"
      >
        <XIcon :size="18" />
      </button>
    </div>
    <nav
      class="navigation"
      aria-label="Разделы"
    >
      <button
        class="nav-item"
        type="button"
        disabled
        aria-label="Главная"
      >
        <HouseIcon
          :size="18"
          :stroke-width="1.5"
        /><span class="nav-label">Главная</span>
      </button>
      <a
        class="nav-item is-active"
        href="#schedule"
        aria-current="page"
        aria-label="Смены"
        @click="$emit('close')"
      ><CalendarDaysIcon
        :size="18"
        :stroke-width="1.5"
      /><span
        class="nav-label"
      >Смены</span></a>
    </nav>
    <button
      class="collapse-button nav-item"
      type="button"
      :aria-expanded="!collapsed"
      :aria-label="collapsed ? 'Развернуть меню' : 'Свернуть меню'"
      @click="$emit('toggle')"
    >
      <component
        :is="collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon"
        :size="18"
        :stroke-width="1.5"
      />
      <span class="nav-label">Свернуть меню</span><span
        v-if="collapsed"
        class="screen-reader-only"
      >Развернуть меню</span>
    </button>
  </aside>
</template>
<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  padding: 22px 12px 24px;
  border-right: 1px solid #e3e5ed;
  background: var(--color-page);
}
.sidebar-brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;
  padding: 0 8px 14px;
}
.brand {
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: -0.6px;
}
.navigation {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 12px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 38px;
  padding: 8px 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.875rem;
  text-decoration: none;
  text-align: left;
  white-space: nowrap;
}
.nav-item.is-active,
.nav-item:hover:not(:disabled) {
  background: white;
}
.collapse-button {
  margin-top: auto;
}
.is-collapsed .nav-label,
.is-collapsed .notification-button {
  display: none;
}
.is-collapsed .nav-item {
  justify-content: center;
  padding-inline: 8px;
}
.is-collapsed .sidebar-brand {
  padding-inline: 0;
  justify-content: center;
}
.screen-reader-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.mobile-close,
.sidebar-backdrop {
  display: none;
}
@media (max-width: 1100px) and (min-width: 851px) {
  .nav-label,
  .notification-button {
    display: none;
  }
  .nav-item,
  .sidebar-brand {
    justify-content: center;
    padding-inline: 0;
  }
}
@media (max-width: 850px) {
  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 30;
    width: 240px;
    transform: translateX(-100%);
    visibility: hidden;
  }
  .sidebar.is-mobile-open {
    transform: translateX(0);
    visibility: visible;
  }
  .sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 25;
    border: 0;
    background: #25262c50;
  }
  .mobile-close {
    display: grid;
  }
  .notification-button,
  .collapse-button {
    display: none;
  }
  .is-collapsed .nav-label {
    display: inline;
  }
  .is-collapsed .nav-item {
    justify-content: flex-start;
  }
  .is-collapsed .sidebar-brand {
    justify-content: space-between;
  }
}
</style>
