import { readonly, ref } from 'vue';

/** Same breakpoint as the `@media (max-width: 768px)` rules in style.css. */
const media = window.matchMedia('(max-width: 768px)');
const isMobile = ref(media.matches);
media.addEventListener('change', (e) => (isMobile.value = e.matches));

/** Phone-width layout flag, shared by every component and updated on resize/rotation. */
export function useIsMobile() {
  return readonly(isMobile);
}
