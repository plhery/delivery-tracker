const f = (value: number) => String(+value.toFixed(2));

/**
 * A stamp's outline: straight edges bitten by round perforations at an even pitch,
 * with a hole at each corner where the rows of holes cross, as on a torn sheet.
 * Every arc bends into the paper, so each one sweeps the same way.
 */
export function perforatedOutline(width: number, height: number, pitch: number, radius: number): string {
  const across = Math.max(1, Math.round(width / pitch));
  const down = Math.max(1, Math.round(height / pitch));
  const dx = width / across;
  const dy = height / down;
  const r = radius;
  const bite = (x: number, y: number) => `A${f(r)} ${f(r)} 0 0 0 ${f(x)} ${f(y)}`;
  let d = `M${f(r)} 0`;
  for (let i = 1; i < across; i++) d += `H${f(i * dx - r)}${bite(i * dx + r, 0)}`;
  d += `H${f(width - r)}${bite(width, r)}`;
  for (let j = 1; j < down; j++) d += `V${f(j * dy - r)}${bite(width, j * dy + r)}`;
  d += `V${f(height - r)}${bite(width - r, height)}`;
  for (let i = across - 1; i > 0; i--) d += `H${f(i * dx + r)}${bite(i * dx - r, height)}`;
  d += `H${f(r)}${bite(0, height - r)}`;
  for (let j = down - 1; j > 0; j--) d += `V${f(j * dy + r)}${bite(0, j * dy - r)}`;
  return `${d}V${f(r)}${bite(r, 0)}Z`;
}

/** Parallel wavy lines from `from` to `to`, one per row. */
export function waves(from: number, to: number, rows: readonly number[], length = 6, height = 1): string {
  const steps = Math.ceil((to - from) / length);
  return rows.map((y) => `M${f(from)} ${f(y)}q${f(length / 4)} ${f(-height * 2)} ${f(length / 2)} 0${`t${f(length / 2)} 0`.repeat(steps * 2 - 1)}`).join('');
}
