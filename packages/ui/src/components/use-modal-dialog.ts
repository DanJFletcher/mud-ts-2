import { useLayoutEffect, type RefObject } from 'react';

export function useModalDialog(dialogRef: RefObject<HTMLDialogElement | null>): void {
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnFocus = document.activeElement;
    const supportsNativeModal = typeof dialog.showModal === 'function';
    if (supportsNativeModal) dialog.showModal();
    else dialog.setAttribute('open', '');

    return () => {
      if (supportsNativeModal && dialog.open) dialog.close();
      else dialog.removeAttribute('open');

      if (returnFocus instanceof HTMLElement) {
        requestAnimationFrame(() => {
          if (returnFocus.isConnected && !returnFocus.matches(':disabled')) returnFocus.focus();
        });
      }
    };
  }, [dialogRef]);
}
