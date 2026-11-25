import { onScopeDispose, watch } from 'vue';

export function useUnsavedChanges(
  hasChanges: () => boolean,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
): void {
  let listening = false;
  // 浏览器显示系统确认框；Electron 宿主通过 will-prevent-unload 处理确认。
  const preventUnload = (event: BeforeUnloadEvent): void => {
    if (!hasChanges()) return;
    event.preventDefault();
    // 同时保留传统 returnValue 信号，兼容不同版本的浏览器内核。
    event.returnValue = 'unsaved';
  };
  const listen = (enabled: boolean): void => {
    if (enabled === listening) return;
    if (enabled) target.addEventListener('beforeunload', preventUnload);
    else target.removeEventListener('beforeunload', preventUnload);
    listening = enabled;
  };
  const stop = watch(hasChanges, listen, { immediate: true, flush: 'sync' });
  onScopeDispose(() => { stop(); listen(false); });
}
