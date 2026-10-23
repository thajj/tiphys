export type ClassValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  return inputs
    .flat(Infinity as 1)
    .filter((value): value is string | number =>
      typeof value === "string" ? value.trim().length > 0 : typeof value === "number",
    )
    .join(" ");
}
