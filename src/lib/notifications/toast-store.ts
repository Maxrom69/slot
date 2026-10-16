import type { Toast } from "@/lib/client/useWorkspace";

export type ToastTone = Toast["tone"];

export class StudioToastStore {
  private toasts: Toast[] = [];
  private seq = 0;
  private listeners = new Set<(toasts: Toast[]) => void>();

  getToasts(): Toast[] {
    return this.toasts;
  }

  subscribe(listener: (toasts: Toast[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.toasts);
    }
  }

  push(message: string, tone: ToastTone = "info", undoable = false): Toast {
    this.seq += 1;
    const toast: Toast = {
      id: `studio-toast-${this.seq}`,
      message,
      tone,
      undoable,
    };
    this.toasts = [...this.toasts, toast];
    this.emit();
    return toast;
  }

  dismiss(id: string): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  clear(): void {
    this.toasts = [];
    this.emit();
  }
}

export const studioToastStore = new StudioToastStore();
