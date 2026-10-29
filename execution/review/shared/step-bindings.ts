export function sourceStepsForBinding(binding: number | number[] | null | undefined): number[] {
  if (binding === null || binding === undefined) return [];
  if (Array.isArray(binding)) return binding;
  return [binding];
}
