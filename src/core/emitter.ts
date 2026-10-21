// Tiny typed event emitter that returns an unsubscribe function (prevents
// listener leaks during 8h operation: every subscription must be disposed).
export class Emitter<T> {
  private ls = new Set<(v: T) => void>();
  on(fn: (v: T) => void): () => void {
    this.ls.add(fn);
    return () => this.ls.delete(fn);
  }
  emit(v: T): void {
    for (const fn of this.ls) fn(v);
  }
  get size(): number {
    return this.ls.size;
  }
  clear(): void {
    this.ls.clear();
  }
}
