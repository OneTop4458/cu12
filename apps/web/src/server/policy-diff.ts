export interface PolicyDiffLine {
  kind: "added" | "removed" | "unchanged";
  text: string;
}

export function buildPolicyDiffLines(previousText: string, currentText: string): PolicyDiffLine[] {
  const previousLines = previousText.split(/\r?\n/);
  const currentLines = currentText.split(/\r?\n/);
  const rowCount = previousLines.length;
  const columnCount = currentLines.length;
  const matrix: number[][] = Array.from({ length: rowCount + 1 }, () =>
    Array<number>(columnCount + 1).fill(0),
  );

  for (let row = rowCount - 1; row >= 0; row -= 1) {
    for (let column = columnCount - 1; column >= 0; column -= 1) {
      if (previousLines[row] === currentLines[column]) {
        matrix[row]![column] = (matrix[row + 1]?.[column + 1] ?? 0) + 1;
      } else {
        matrix[row]![column] = Math.max(
          matrix[row + 1]?.[column] ?? 0,
          matrix[row]?.[column + 1] ?? 0,
        );
      }
    }
  }

  const diff: PolicyDiffLine[] = [];
  let row = 0;
  let column = 0;

  while (row < rowCount && column < columnCount) {
    if (previousLines[row] === currentLines[column]) {
      diff.push({
        kind: "unchanged",
        text: currentLines[column] ?? "",
      });
      row += 1;
      column += 1;
      continue;
    }

    if ((matrix[row + 1]?.[column] ?? 0) >= (matrix[row]?.[column + 1] ?? 0)) {
      diff.push({
        kind: "removed",
        text: previousLines[row] ?? "",
      });
      row += 1;
      continue;
    }

    diff.push({
      kind: "added",
      text: currentLines[column] ?? "",
    });
    column += 1;
  }

  while (row < rowCount) {
    diff.push({
      kind: "removed",
      text: previousLines[row] ?? "",
    });
    row += 1;
  }

  while (column < columnCount) {
    diff.push({
      kind: "added",
      text: currentLines[column] ?? "",
    });
    column += 1;
  }

  return diff;
}
