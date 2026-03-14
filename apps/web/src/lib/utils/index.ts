export const objectFromEntries = <T extends ReadonlyArray<readonly [PropertyKey, unknown]>>(
  entries: T,
): { [K in T[number] as K[0]]: K[1] } => Object.fromEntries(entries) as never;
